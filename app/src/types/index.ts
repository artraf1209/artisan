// Re-export generated Supabase types once `make sb-types` has been run.
// Until then, use a permissive placeholder so the app compiles.

export type Database = {
  public: {
    Tables: {
      signals: {
        Row: {
          id: string
          model: string
          symbol: string
          direction: 'long' | 'short' | 'flat'
          confidence: number
          metadata: Record<string, unknown> | null
          executed: boolean
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['signals']['Row'], 'id' | 'created_at'>
        Update: Partial<Database['public']['Tables']['signals']['Insert']>
      }
      trades: {
        Row: {
          id: string
          symbol: string
          side: 'buy' | 'sell'
          quantity: number
          price: number
          status: 'pending' | 'filled' | 'cancelled' | 'rejected'
          broker_order_id: string | null
          signal_id: string | null
          paper: boolean
          created_at: string
          filled_at: string | null
        }
        Insert: Omit<Database['public']['Tables']['trades']['Row'], 'id' | 'created_at'>
        Update: Partial<Database['public']['Tables']['trades']['Insert']>
      }
      positions: {
        Row: {
          id: string
          symbol: string
          quantity: number
          avg_entry_price: number
          current_price: number | null
          unrealized_pnl: number | null
          paper: boolean
          updated_at: string
        }
        Insert: Omit<Database['public']['Tables']['positions']['Row'], 'id'>
        Update: Partial<Database['public']['Tables']['positions']['Insert']>
      }
      logs: {
        Row: {
          id: string
          level: 'debug' | 'info' | 'warn' | 'error'
          source: string
          message: string
          context: Record<string, unknown> | null
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['logs']['Row'], 'id' | 'created_at'>
        Update: Partial<Database['public']['Tables']['logs']['Insert']>
      }
      alerts: {
        Row: {
          id: string
          chat_id: string
          message: string
          trigger: string | null
          trade_id: string | null
          sent: boolean
          sent_at: string | null
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['alerts']['Row'], 'id' | 'created_at'>
        Update: Partial<Database['public']['Tables']['alerts']['Insert']>
      }
      accounts: {
        Row: {
          id: string
          user_id: string
          broker: string
          paper: boolean
          equity: number | null
          cash: number | null
          updated_at: string
        }
        Insert: Omit<Database['public']['Tables']['accounts']['Row'], 'id' | 'updated_at'>
        Update: Partial<Database['public']['Tables']['accounts']['Insert']> & {
          updated_at?: string
        }
      }
      price_bars: {
        Row: {
          symbol: string
          bar_time: string
          open: number
          high: number
          low: number
          close: number
          volume: number
          vwap: number | null
          source: string
        }
        Insert: Database['public']['Tables']['price_bars']['Row']
        Update: Partial<Database['public']['Tables']['price_bars']['Insert']>
      }
      strategies: {
        Row: {
          id: string
          name: string
          horizon: 'long' | 'swing' | 'intraday'
          f_weight: number
          t_weight: number
          s_weight: number
          threshold: number
          max_positions: number
          position_frac: number
          active: boolean
          goal_growth_pct: number | null
          goal_months: number | null
          risk_level: 'conservative' | 'moderate' | 'aggressive' | null
          start_equity: number | null
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['strategies']['Row'], 'id' | 'created_at'>
        Update: Partial<Database['public']['Tables']['strategies']['Insert']>
      }
      universes: {
        Row: {
          id: string
          strategy_id: string
          symbol: string
          added_at: string
          active: boolean
          screened_at: string | null
        }
        Insert: Omit<Database['public']['Tables']['universes']['Row'], 'id' | 'added_at'>
        Update: Partial<Database['public']['Tables']['universes']['Insert']>
      }
      indicator_values: {
        Row: {
          id: string
          symbol: string
          computed_at: string
          rsi_14: number | null
          macd_line: number | null
          macd_signal: number | null
          macd_hist: number | null
          bb_upper: number | null
          bb_mid: number | null
          bb_lower: number | null
          atr_14: number | null
          sma_50: number | null
          sma_200: number | null
          adx_14: number | null
          obv: number | null
          vol_ratio: number | null
        }
        Insert: Omit<Database['public']['Tables']['indicator_values']['Row'], 'id' | 'computed_at'>
        Update: Partial<Database['public']['Tables']['indicator_values']['Insert']>
      }
      factor_scores: {
        Row: {
          id: string
          symbol: string
          strategy_id: string | null
          scored_at: string
          value_z: number | null
          quality_z: number | null
          momentum_z: number | null
          low_vol_z: number | null
          growth_z: number | null
          value_prev: number | null
          quality_prev: number | null
          momentum_prev: number | null
          low_vol_prev: number | null
          growth_prev: number | null
          composite_z: number | null
          rank: number | null
          is_new: boolean
          hard_filter_pass: boolean
          sector: string | null
        }
        Insert: Omit<Database['public']['Tables']['factor_scores']['Row'], 'id'>
        Update: Partial<Database['public']['Tables']['factor_scores']['Insert']>
      }
      entry_signals: {
        Row: {
          id: string
          symbol: string
          strategy_id: string | null
          evaluated_at: string
          gate_market: boolean | null
          gate_trend: boolean | null
          setup_type: string | null
          gate_confirmed: boolean | null
          entry_price: number | null
          stop_price: number | null
          target_price: number | null
          atr: number | null
          r_multiple: number | null
          shares: number | null
          dollar_risk: number | null
          actionable: boolean
        }
        Insert: Omit<Database['public']['Tables']['entry_signals']['Row'], 'id'>
        Update: Partial<Database['public']['Tables']['entry_signals']['Insert']>
      }
      composite_scores: {
        Row: {
          id: string
          symbol: string
          strategy_id: string
          scored_at: string
          f_score: number
          t_score: number
          s_score: number
          composite: number
          pillars_passed: number
        }
        Insert: Omit<Database['public']['Tables']['composite_scores']['Row'], 'id' | 'scored_at'>
        Update: Partial<Database['public']['Tables']['composite_scores']['Insert']>
      }
      signal_events: {
        Row: {
          id: string
          symbol: string
          strategy_id: string
          score_id: string | null
          direction: 'long' | 'flat'
          composite_score: number
          f_score: number
          t_score: number
          s_score: number
          pillars_passed: number
          earnings_blackout: boolean
          stop_price: number | null
          target_price: number | null
          atr_at_signal: number | null
          status: 'pending' | 'approved' | 'rejected' | 'executed' | 'expired'
          created_at: string
          reviewed_at: string | null
          reviewed_by: string | null
          review_note: string | null
        }
        Insert: Omit<Database['public']['Tables']['signal_events']['Row'], 'id' | 'created_at' | 'reviewed_at' | 'reviewed_by' | 'review_note'>
        Update: Partial<Database['public']['Tables']['signal_events']['Insert']> & {
          reviewed_at?: string | null
          reviewed_by?: string | null
          review_note?: string | null
        }
      }
      trade_intents: {
        Row: {
          id: string
          signal_id: string
          account_id: string
          symbol: string
          side: 'buy' | 'sell'
          quantity: number
          dollar_value: number
          order_type: 'market' | 'limit'
          limit_price: number | null
          stop_price: number | null
          status: 'pending' | 'submitted' | 'filled' | 'cancelled' | 'rejected'
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['trade_intents']['Row'], 'id' | 'created_at'>
        Update: Partial<Database['public']['Tables']['trade_intents']['Insert']>
      }
      trade_executions: {
        Row: {
          id: string
          intent_id: string
          broker_order_id: string | null
          filled_qty: number | null
          filled_price: number | null
          filled_at: string | null
          fees: number | null
          status: 'pending' | 'filled' | 'partial' | 'cancelled' | 'rejected'
          raw_response: Record<string, unknown> | null
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['trade_executions']['Row'], 'id' | 'created_at'>
        Update: Partial<Database['public']['Tables']['trade_executions']['Insert']>
      }
      portfolio_positions: {
        Row: {
          id: string
          account_id: string
          symbol: string
          quantity: number
          avg_entry_price: number
          current_price: number | null
          unrealized_pnl: number | null
          stop_price: number | null
          target_price: number | null
          signal_id: string | null
          opened_at: string
          updated_at: string
        }
        Insert: Omit<Database['public']['Tables']['portfolio_positions']['Row'], 'id' | 'opened_at' | 'updated_at'>
        Update: Partial<Database['public']['Tables']['portfolio_positions']['Insert']>
      }
      llm_analyses: {
        Row: {
          id: string
          analysis_type: 'thesis' | 'briefing'
          symbol: string | null
          signal_id: string | null
          model: string
          prompt_tokens: number | null
          output_tokens: number | null
          cache_read_tokens: number | null
          cost_usd: number | null
          content: string
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['llm_analyses']['Row'], 'id' | 'created_at'>
        Update: Partial<Database['public']['Tables']['llm_analyses']['Insert']>
      }
    }
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}

export type Signal = Database['public']['Tables']['signals']['Row']
export type Trade = Database['public']['Tables']['trades']['Row']
export type Position = Database['public']['Tables']['positions']['Row']
export type Log = Database['public']['Tables']['logs']['Row']
export type Alert = Database['public']['Tables']['alerts']['Row']
export type Account = Database['public']['Tables']['accounts']['Row']
export type PriceBar = Database['public']['Tables']['price_bars']['Row']
export type Strategy = Database['public']['Tables']['strategies']['Row']
export type Universe = Database['public']['Tables']['universes']['Row']
export type IndicatorValues = Database['public']['Tables']['indicator_values']['Row']
export type FactorScore = Database['public']['Tables']['factor_scores']['Row']
export type EntrySignal = Database['public']['Tables']['entry_signals']['Row']
export type CompositeScore = Database['public']['Tables']['composite_scores']['Row']
export type SignalEvent = Database['public']['Tables']['signal_events']['Row']
export type TradeIntent = Database['public']['Tables']['trade_intents']['Row']
export type TradeExecution = Database['public']['Tables']['trade_executions']['Row']
export type PortfolioPosition = Database['public']['Tables']['portfolio_positions']['Row']
export type LlmAnalysis = Database['public']['Tables']['llm_analyses']['Row']
