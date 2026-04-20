/*
  # Create trade_positions table

  1. New Tables
    - `trade_positions`
      - `id` (uuid, primary key)
      - `user_id` (uuid, from anonymous auth)
      - `asset` (text) - e.g. "BTC"
      - `symbol` (text) - e.g. "BTCUSDT"
      - `direction` (text) - "Long" or "Short"
      - `entry_price` (numeric) - price at which position was opened
      - `leverage` (integer) - 1 to 1000
      - `size_usdt` (numeric) - position size in USDT
      - `status` (text) - "active", "planned", or "closed"
      - `close_price` (numeric, nullable)
      - `notes` (text)
      - `created_at` (timestamptz)
      - `closed_at` (timestamptz, nullable)

  2. Security
    - Enable RLS
    - Policies for authenticated (anonymous) users to manage only their own positions
*/

CREATE TABLE IF NOT EXISTS trade_positions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  asset text NOT NULL DEFAULT '',
  symbol text NOT NULL DEFAULT '',
  direction text NOT NULL DEFAULT 'Long' CHECK (direction IN ('Long', 'Short')),
  entry_price numeric NOT NULL DEFAULT 0,
  leverage integer NOT NULL DEFAULT 1 CHECK (leverage >= 1 AND leverage <= 1000),
  size_usdt numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'planned', 'closed')),
  close_price numeric,
  notes text DEFAULT '',
  created_at timestamptz DEFAULT now(),
  closed_at timestamptz
);

ALTER TABLE trade_positions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own positions"
  ON trade_positions FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own positions"
  ON trade_positions FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own positions"
  ON trade_positions FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own positions"
  ON trade_positions FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);
