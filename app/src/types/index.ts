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
