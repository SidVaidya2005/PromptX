export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      attachments: {
        Row: {
          created_at: string
          id: string
          inline_path: string | null
          message_id: string | null
          mime_type: string
          position: number
          size_bytes: number
          status: string
          storage_path: string
          thumb_path: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          inline_path?: string | null
          message_id?: string | null
          mime_type: string
          position?: number
          size_bytes: number
          status?: string
          storage_path: string
          thumb_path?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          inline_path?: string | null
          message_id?: string | null
          mime_type?: string
          position?: number
          size_bytes?: number
          status?: string
          storage_path?: string
          thumb_path?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "attachments_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          archived_at: string | null
          created_at: string
          id: string
          model_id: string
          pinned_at: string | null
          provider: Database["public"]["Enums"]["provider"]
          share_slug: string | null
          shared_at: string | null
          system_prompt: string | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          id?: string
          model_id: string
          pinned_at?: string | null
          provider: Database["public"]["Enums"]["provider"]
          share_slug?: string | null
          shared_at?: string | null
          system_prompt?: string | null
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          id?: string
          model_id?: string
          pinned_at?: string | null
          provider?: Database["public"]["Enums"]["provider"]
          share_slug?: string | null
          shared_at?: string | null
          system_prompt?: string | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      messages: {
        Row: {
          content: string
          conversation_id: string
          created_at: string
          error_message: string | null
          id: string
          input_tokens: number | null
          model_id: string | null
          output_tokens: number | null
          provider: Database["public"]["Enums"]["provider"] | null
          role: Database["public"]["Enums"]["message_role"]
          search_vector: unknown
          status: Database["public"]["Enums"]["message_status"]
          used_shared_key: boolean
          user_id: string
        }
        Insert: {
          content: string
          conversation_id: string
          created_at?: string
          error_message?: string | null
          id?: string
          input_tokens?: number | null
          model_id?: string | null
          output_tokens?: number | null
          provider?: Database["public"]["Enums"]["provider"] | null
          role: Database["public"]["Enums"]["message_role"]
          search_vector?: unknown
          status?: Database["public"]["Enums"]["message_status"]
          used_shared_key?: boolean
          user_id: string
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string
          error_message?: string | null
          id?: string
          input_tokens?: number | null
          model_id?: string | null
          output_tokens?: number | null
          provider?: Database["public"]["Enums"]["provider"] | null
          role?: Database["public"]["Enums"]["message_role"]
          search_vector?: unknown
          status?: Database["public"]["Enums"]["message_status"]
          used_shared_key?: boolean
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          email: string
          id: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          email: string
          id: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          email?: string
          id?: string
        }
        Relationships: []
      }
      prompts: {
        Row: {
          body: string
          created_at: string
          id: string
          tags: string[]
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          tags?: string[]
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          tags?: string[]
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      provider_keys: {
        Row: {
          auth_tag: string
          ciphertext: string
          created_at: string
          id: string
          iv: string
          label: string | null
          last_four: string
          last_used_at: string | null
          provider: Database["public"]["Enums"]["provider"]
          user_id: string
        }
        Insert: {
          auth_tag: string
          ciphertext: string
          created_at?: string
          id?: string
          iv: string
          label?: string | null
          last_four: string
          last_used_at?: string | null
          provider: Database["public"]["Enums"]["provider"]
          user_id: string
        }
        Update: {
          auth_tag?: string
          ciphertext?: string
          created_at?: string
          id?: string
          iv?: string
          label?: string | null
          last_four?: string
          last_used_at?: string | null
          provider?: Database["public"]["Enums"]["provider"]
          user_id?: string
        }
        Relationships: []
      }
      shared_key_budget: {
        Row: {
          estimated_usd: number
          id: number
          input_tokens: number
          output_tokens: number
          period_month: string
          tripped_at: string | null
        }
        Insert: {
          estimated_usd?: number
          id: number
          input_tokens?: number
          output_tokens?: number
          period_month: string
          tripped_at?: string | null
        }
        Update: {
          estimated_usd?: number
          id?: number
          input_tokens?: number
          output_tokens?: number
          period_month?: string
          tripped_at?: string | null
        }
        Relationships: []
      }
      shared_key_usage: {
        Row: {
          input_tokens: number
          message_count: number
          output_tokens: number
          updated_at: string
          usage_date: string
          user_id: string
        }
        Insert: {
          input_tokens?: number
          message_count?: number
          output_tokens?: number
          updated_at?: string
          usage_date: string
          user_id: string
        }
        Update: {
          input_tokens?: number
          message_count?: number
          output_tokens?: number
          updated_at?: string
          usage_date?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      reap_attachments_tick: { Args: never; Returns: undefined }
      reconcile_shared_key_usage: { Args: never; Returns: undefined }
      record_shared_tokens: {
        Args: {
          p_input_tokens: number
          p_output_tokens: number
          p_user_id: string
        }
        Returns: undefined
      }
      release_shared_slot: { Args: { p_user_id: string }; Returns: undefined }
      reserve_shared_slot: {
        Args: { p_limit: number; p_user_id: string }
        Returns: number
      }
    }
    Enums: {
      message_role: "user" | "assistant"
      message_status: "streaming" | "complete" | "error"
      provider: "openai" | "anthropic" | "google" | "openrouter"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      message_role: ["user", "assistant"],
      message_status: ["streaming", "complete", "error"],
      provider: ["openai", "anthropic", "google", "openrouter"],
    },
  },
} as const
