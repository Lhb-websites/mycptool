import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const { asset, exchange, margin, timeframe, minProb } = await req.json();
    const symbol = `${asset.toUpperCase()}USDT`;

    const [tickerRes, klinesRes, klines4hRes] = await Promise.all([
      fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}`),
      fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1h&limit=50`),
      fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=4h&limit=50`),
    ]);

    if (!tickerRes.ok) {
      throw new Error(`Symbol ${symbol} not found on Binance`);
    }

    const ticker = await tickerRes.json();
    const klines1h: number[][] = (await klinesRes.json()).map((k: string[]) => k.map(Number));
    const klines4h: number[][] = (await klines4hRes.json()).map((k: string[]) => k.map(Number));

    const closes1h = klines1h.map((k) => k[4]);
    const closes4h = klines4h.map((k) => k[4]);
    const volumes1h = klines1h.map((k) => k[5]);

    const sma20_1h = closes1h.slice(-20).reduce((a, b) => a + b, 0) / 20;
    const sma50_1h = closes1h.length >= 50 ? closes1h.slice(-50).reduce((a, b) => a + b, 0) / 50 : sma20_1h;
    const sma20_4h = closes4h.slice(-20).reduce((a, b) => a + b, 0) / 20;

    const avgVol = volumes1h.slice(-20).reduce((a, b) => a + b, 0) / 20;
    const currentVol = volumes1h[volumes1h.length - 1];
    const volRatio = currentVol / avgVol;

    const rsiPeriod = 14;
    const rsiCloses = closes1h.slice(-rsiPeriod - 1);
    let gains = 0, losses = 0;
    for (let i = 1; i < rsiCloses.length; i++) {
      const diff = rsiCloses[i] - rsiCloses[i - 1];
      if (diff > 0) gains += diff;
      else losses -= diff;
    }
    const avgGain = gains / rsiPeriod;
    const avgLoss = losses / rsiPeriod;
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    const rsi = 100 - 100 / (1 + rs);

    const recentHighs = closes1h.slice(-24);
    const recentLow24h = Math.min(...recentHighs);
    const recentHigh24h = Math.max(...recentHighs);

    const marketContext = {
      currentPrice: parseFloat(ticker.lastPrice),
      priceChange24h: parseFloat(ticker.priceChangePercent),
      volume24h: parseFloat(ticker.quoteVolume),
      high24h: parseFloat(ticker.highPrice),
      low24h: parseFloat(ticker.lowPrice),
      sma20_1h: sma20_1h.toFixed(2),
      sma50_1h: sma50_1h.toFixed(2),
      sma20_4h: sma20_4h.toFixed(2),
      rsi14: rsi.toFixed(1),
      volumeRatio: volRatio.toFixed(2),
      recentHigh24h: recentHigh24h.toFixed(2),
      recentLow24h: recentLow24h.toFixed(2),
    };

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "ANTHROPIC_API_KEY not configured", marketData: marketContext }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const prompt = `You are an expert crypto futures trading analyst. You have access to live market data.

LIVE MARKET DATA — ${symbol} on ${exchange}:
- Current Price: $${marketContext.currentPrice.toLocaleString()}
- 24h Change: ${marketContext.priceChange24h}%
- 24h Volume (USDT): $${marketContext.volume24h.toLocaleString(undefined, { maximumFractionDigits: 0 })}
- 24h High: $${marketContext.high24h}
- 24h Low: $${marketContext.low24h}
- SMA20 (1h): $${marketContext.sma20_1h}
- SMA50 (1h): $${marketContext.sma50_1h}
- SMA20 (4h): $${marketContext.sma20_4h}
- RSI14 (1h): ${marketContext.rsi14}
- Volume Ratio (vs 20-period avg): ${marketContext.volumeRatio}x
- Recent 24h High: $${marketContext.recentHigh24h}
- Recent 24h Low: $${marketContext.recentLow24h}

ANALYSIS PARAMETERS:
- Exchange: ${exchange}
- Margin Mode: ${margin}
- Timeframes: ${timeframe === "all" ? "15m, 30m, 1h, 4h, 6h, 12h, 1d" : timeframe}
- Minimum Probability: ${minProb}

Using the real market data above, provide a detailed futures trading analysis. Return ONLY valid JSON:
{
  "probability": "XX%",
  "position": "Long" or "Short",
  "timeframe": "best timeframe for this setup",
  "leverage": "Xx (conservative given volatility)",
  "entry": "$XX,XXX",
  "stop_loss": "$XX,XXX",
  "take_profit": "$XX,XXX",
  "risk_reward": "1:X.X",
  "structure_trend": "describe market structure using the real data (SMA cross, trend direction, recent highs/lows)",
  "key_levels": "specific support and resistance price levels based on real 24h data",
  "momentum": "RSI reading interpretation and volume analysis using the real numbers",
  "risk": "specific risks at current price level with dollar amounts",
  "rejections": ["scenario 1 with price", "scenario 2 with price", "scenario 3 with price"],
  "reasoning": "2-3 paragraph detailed reasoning using the actual price data provided"
}`;

    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 2000,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const claudeData = await claudeRes.json();
    const responseText = (claudeData.content || [])
      .filter((item: { type: string }) => item.type === "text")
      .map((item: { text: string }) => item.text)
      .join("\n");

    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    const analysis = jsonMatch ? JSON.parse(jsonMatch[0]) : null;

    return new Response(
      JSON.stringify({ analysis, marketData: marketContext }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    const err = error as Error;
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
