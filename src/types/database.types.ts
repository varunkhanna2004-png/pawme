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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      banned_phones: {
        Row: {
          banned_at: string
          banned_by: string | null
          phone_hash: string
          reason: Database["public"]["Enums"]["report_reason"] | null
          report_id: string | null
        }
        Insert: {
          banned_at?: string
          banned_by?: string | null
          phone_hash: string
          reason?: Database["public"]["Enums"]["report_reason"] | null
          report_id?: string | null
        }
        Update: {
          banned_at?: string
          banned_by?: string | null
          phone_hash?: string
          reason?: Database["public"]["Enums"]["report_reason"] | null
          report_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "banned_phones_banned_by_fkey"
            columns: ["banned_by"]
            isOneToOne: false
            referencedRelation: "owners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "banned_phones_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "reports"
            referencedColumns: ["id"]
          },
        ]
      }
      blocks: {
        Row: {
          blocked_id: string
          blocker_id: string
          created_at: string
        }
        Insert: {
          blocked_id: string
          blocker_id: string
          created_at?: string
        }
        Update: {
          blocked_id?: string
          blocker_id?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "blocks_blocked_id_fkey"
            columns: ["blocked_id"]
            isOneToOne: false
            referencedRelation: "owners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "blocks_blocker_id_fkey"
            columns: ["blocker_id"]
            isOneToOne: false
            referencedRelation: "owners"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          a_last_read_at: string | null
          b_last_read_at: string | null
          created_at: string
          id: string
          last_message_at: string | null
          last_message_preview: string | null
          match_id: string
          owner_a_id: string
          owner_b_id: string
        }
        Insert: {
          a_last_read_at?: string | null
          b_last_read_at?: string | null
          created_at?: string
          id?: string
          last_message_at?: string | null
          last_message_preview?: string | null
          match_id: string
          owner_a_id: string
          owner_b_id: string
        }
        Update: {
          a_last_read_at?: string | null
          b_last_read_at?: string | null
          created_at?: string
          id?: string
          last_message_at?: string | null
          last_message_preview?: string | null
          match_id?: string
          owner_a_id?: string
          owner_b_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: true
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_owner_a_id_fkey"
            columns: ["owner_a_id"]
            isOneToOne: false
            referencedRelation: "owners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_owner_b_id_fkey"
            columns: ["owner_b_id"]
            isOneToOne: false
            referencedRelation: "owners"
            referencedColumns: ["id"]
          },
        ]
      }
      likes: {
        Row: {
          action: Database["public"]["Enums"]["swipe_action"]
          created_at: string
          from_owner_id: string
          from_pet_id: string
          to_pet_id: string
        }
        Insert: {
          action: Database["public"]["Enums"]["swipe_action"]
          created_at?: string
          from_owner_id: string
          from_pet_id: string
          to_pet_id: string
        }
        Update: {
          action?: Database["public"]["Enums"]["swipe_action"]
          created_at?: string
          from_owner_id?: string
          from_pet_id?: string
          to_pet_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "likes_from_owner_id_fkey"
            columns: ["from_owner_id"]
            isOneToOne: false
            referencedRelation: "owners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "likes_from_pet_id_fkey"
            columns: ["from_pet_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "likes_to_pet_id_fkey"
            columns: ["to_pet_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
        ]
      }
      matches: {
        Row: {
          created_at: string
          id: string
          owner_a_id: string
          owner_b_id: string
          pet_a_id: string
          pet_b_id: string
          status: Database["public"]["Enums"]["match_status"]
          unmatched_at: string | null
          unmatched_by: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          owner_a_id: string
          owner_b_id: string
          pet_a_id: string
          pet_b_id: string
          status?: Database["public"]["Enums"]["match_status"]
          unmatched_at?: string | null
          unmatched_by?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          owner_a_id?: string
          owner_b_id?: string
          pet_a_id?: string
          pet_b_id?: string
          status?: Database["public"]["Enums"]["match_status"]
          unmatched_at?: string | null
          unmatched_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "matches_owner_a_id_fkey"
            columns: ["owner_a_id"]
            isOneToOne: false
            referencedRelation: "owners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matches_owner_b_id_fkey"
            columns: ["owner_b_id"]
            isOneToOne: false
            referencedRelation: "owners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matches_pet_a_id_fkey"
            columns: ["pet_a_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matches_pet_b_id_fkey"
            columns: ["pet_b_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matches_unmatched_by_fkey"
            columns: ["unmatched_by"]
            isOneToOne: false
            referencedRelation: "owners"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          body: string | null
          conversation_id: string
          created_at: string
          id: string
          kind: Database["public"]["Enums"]["message_kind"]
          payload: Json | null
          photo_path: string | null
          sender_id: string
        }
        Insert: {
          body?: string | null
          conversation_id: string
          created_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["message_kind"]
          payload?: Json | null
          photo_path?: string | null
          sender_id?: string
        }
        Update: {
          body?: string | null
          conversation_id?: string
          created_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["message_kind"]
          payload?: Json | null
          photo_path?: string | null
          sender_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "owners"
            referencedColumns: ["id"]
          },
        ]
      }
      owners: {
        Row: {
          adult_confirmed_at: string | null
          cluster_id: string | null
          created_at: string
          discoverable: boolean
          display_name: string | null
          email: string | null
          id: string
          is_seed: boolean
          last_active_at: string
          loc_lat: number | null
          loc_lng: number | null
          location_updated_at: string | null
          notify_email: boolean
          notify_in_app: boolean
          phone_verified_at: string | null
          referral_code: string
          referred_by: string | null
          role: Database["public"]["Enums"]["owner_role"]
          show_distance: boolean
          status: Database["public"]["Enums"]["owner_status"]
          subscription_tier: string
          suspended_at: string | null
          updated_at: string
        }
        Insert: {
          adult_confirmed_at?: string | null
          cluster_id?: string | null
          created_at?: string
          discoverable?: boolean
          display_name?: string | null
          email?: string | null
          id: string
          is_seed?: boolean
          last_active_at?: string
          loc_lat?: number | null
          loc_lng?: number | null
          location_updated_at?: string | null
          notify_email?: boolean
          notify_in_app?: boolean
          phone_verified_at?: string | null
          referral_code?: string
          referred_by?: string | null
          role?: Database["public"]["Enums"]["owner_role"]
          show_distance?: boolean
          status?: Database["public"]["Enums"]["owner_status"]
          subscription_tier?: string
          suspended_at?: string | null
          updated_at?: string
        }
        Update: {
          adult_confirmed_at?: string | null
          cluster_id?: string | null
          created_at?: string
          discoverable?: boolean
          display_name?: string | null
          email?: string | null
          id?: string
          is_seed?: boolean
          last_active_at?: string
          loc_lat?: number | null
          loc_lng?: number | null
          location_updated_at?: string | null
          notify_email?: boolean
          notify_in_app?: boolean
          phone_verified_at?: string | null
          referral_code?: string
          referred_by?: string | null
          role?: Database["public"]["Enums"]["owner_role"]
          show_distance?: boolean
          status?: Database["public"]["Enums"]["owner_status"]
          subscription_tier?: string
          suspended_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "owners_cluster_id_fkey"
            columns: ["cluster_id"]
            isOneToOne: false
            referencedRelation: "ranking_config"
            referencedColumns: ["cluster_id"]
          },
          {
            foreignKeyName: "owners_referred_by_fkey"
            columns: ["referred_by"]
            isOneToOne: false
            referencedRelation: "owners"
            referencedColumns: ["id"]
          },
        ]
      }
      pet_photos: {
        Row: {
          created_at: string
          id: string
          pet_id: string
          position: number
          storage_path: string
        }
        Insert: {
          created_at?: string
          id?: string
          pet_id: string
          position: number
          storage_path: string
        }
        Update: {
          created_at?: string
          id?: string
          pet_id?: string
          position?: number
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "pet_photos_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
        ]
      }
      pet_tags: {
        Row: {
          pet_id: string
          tag: Database["public"]["Enums"]["pet_tag"]
        }
        Insert: {
          pet_id: string
          tag: Database["public"]["Enums"]["pet_tag"]
        }
        Update: {
          pet_id?: string
          tag?: Database["public"]["Enums"]["pet_tag"]
        }
        Relationships: [
          {
            foreignKeyName: "pet_tags_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
        ]
      }
      pets: {
        Row: {
          birth_date: string
          breed: string | null
          cluster_id: string | null
          created_at: string
          id: string
          intents: Database["public"]["Enums"]["pet_intent"][]
          is_mixed: boolean
          is_seed: boolean
          last_active_at: string
          last_rewind_at: string | null
          name: string
          owner_id: string
          sex: Database["public"]["Enums"]["pet_sex"]
          size: Database["public"]["Enums"]["pet_size"]
          species: Database["public"]["Enums"]["pet_species"]
          updated_at: string
        }
        Insert: {
          birth_date: string
          breed?: string | null
          cluster_id?: string | null
          created_at?: string
          id?: string
          intents: Database["public"]["Enums"]["pet_intent"][]
          is_mixed?: boolean
          is_seed?: boolean
          last_active_at?: string
          last_rewind_at?: string | null
          name: string
          owner_id: string
          sex: Database["public"]["Enums"]["pet_sex"]
          size: Database["public"]["Enums"]["pet_size"]
          species: Database["public"]["Enums"]["pet_species"]
          updated_at?: string
        }
        Update: {
          birth_date?: string
          breed?: string | null
          cluster_id?: string | null
          created_at?: string
          id?: string
          intents?: Database["public"]["Enums"]["pet_intent"][]
          is_mixed?: boolean
          is_seed?: boolean
          last_active_at?: string
          last_rewind_at?: string | null
          name?: string
          owner_id?: string
          sex?: Database["public"]["Enums"]["pet_sex"]
          size?: Database["public"]["Enums"]["pet_size"]
          species?: Database["public"]["Enums"]["pet_species"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pets_cluster_id_fkey"
            columns: ["cluster_id"]
            isOneToOne: false
            referencedRelation: "ranking_config"
            referencedColumns: ["cluster_id"]
          },
          {
            foreignKeyName: "pets_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "owners"
            referencedColumns: ["id"]
          },
        ]
      }
      playdate_feedback: {
        Row: {
          created_at: string
          id: string
          match_id: string
          owner_id: string
          rating: number
        }
        Insert: {
          created_at?: string
          id?: string
          match_id: string
          owner_id: string
          rating: number
        }
        Update: {
          created_at?: string
          id?: string
          match_id?: string
          owner_id?: string
          rating?: number
        }
        Relationships: [
          {
            foreignKeyName: "playdate_feedback_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "playdate_feedback_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "owners"
            referencedColumns: ["id"]
          },
        ]
      }
      ranking_config: {
        Row: {
          allow_seed: boolean
          boundary: unknown
          centroid_lat: number
          centroid_lng: number
          cluster_id: string
          deck_size: number
          grid_m: number
          is_active: boolean
          name: string
          pass_cooldown_days: number
          radius_m: number
          recency_halflife_days: number
          super_paw_daily_limit: number
          updated_at: string
          w_age_fit: number
          w_completeness: number
          w_intent_overlap: number
          w_liked_you: number
          w_proximity: number
          w_random: number
          w_recency: number
          w_size_fit: number
          w_tag_compatibility: number
        }
        Insert: {
          allow_seed?: boolean
          boundary?: unknown
          centroid_lat: number
          centroid_lng: number
          cluster_id: string
          deck_size?: number
          grid_m?: number
          is_active?: boolean
          name: string
          pass_cooldown_days?: number
          radius_m: number
          recency_halflife_days?: number
          super_paw_daily_limit?: number
          updated_at?: string
          w_age_fit?: number
          w_completeness?: number
          w_intent_overlap?: number
          w_liked_you?: number
          w_proximity?: number
          w_random?: number
          w_recency?: number
          w_size_fit?: number
          w_tag_compatibility?: number
        }
        Update: {
          allow_seed?: boolean
          boundary?: unknown
          centroid_lat?: number
          centroid_lng?: number
          cluster_id?: string
          deck_size?: number
          grid_m?: number
          is_active?: boolean
          name?: string
          pass_cooldown_days?: number
          radius_m?: number
          recency_halflife_days?: number
          super_paw_daily_limit?: number
          updated_at?: string
          w_age_fit?: number
          w_completeness?: number
          w_intent_overlap?: number
          w_liked_you?: number
          w_proximity?: number
          w_random?: number
          w_recency?: number
          w_size_fit?: number
          w_tag_compatibility?: number
        }
        Relationships: []
      }
      reports: {
        Row: {
          created_at: string
          details: string | null
          id: string
          message_id: string | null
          message_snapshot: string | null
          reason: Database["public"]["Enums"]["report_reason"]
          reporter_id: string | null
          resolved_at: string | null
          resolved_by: string | null
          status: Database["public"]["Enums"]["report_status"]
          target_owner_id: string | null
          target_pet_id: string | null
        }
        Insert: {
          created_at?: string
          details?: string | null
          id?: string
          message_id?: string | null
          message_snapshot?: string | null
          reason: Database["public"]["Enums"]["report_reason"]
          reporter_id?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: Database["public"]["Enums"]["report_status"]
          target_owner_id?: string | null
          target_pet_id?: string | null
        }
        Update: {
          created_at?: string
          details?: string | null
          id?: string
          message_id?: string | null
          message_snapshot?: string | null
          reason?: Database["public"]["Enums"]["report_reason"]
          reporter_id?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: Database["public"]["Enums"]["report_status"]
          target_owner_id?: string | null
          target_pet_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reports_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_reporter_id_fkey"
            columns: ["reporter_id"]
            isOneToOne: false
            referencedRelation: "owners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "owners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_target_owner_id_fkey"
            columns: ["target_owner_id"]
            isOneToOne: false
            referencedRelation: "owners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_target_pet_id_fkey"
            columns: ["target_pet_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
        ]
      }
      waitlist: {
        Row: {
          area_label: string | null
          created_at: string
          email: string | null
          loc_lat: number | null
          loc_lng: number | null
          notified_at: string | null
          owner_id: string
        }
        Insert: {
          area_label?: string | null
          created_at?: string
          email?: string | null
          loc_lat?: number | null
          loc_lng?: number | null
          notified_at?: string | null
          owner_id: string
        }
        Update: {
          area_label?: string | null
          created_at?: string
          email?: string | null
          loc_lat?: number | null
          loc_lng?: number | null
          notified_at?: string | null
          owner_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "waitlist_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: true
            referencedRelation: "owners"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      claim_referral: { Args: { p_code: string }; Returns: boolean }
      enter_cluster: {
        Args: { p_area_label?: string; p_lat: number; p_lng: number }
        Returns: Json
      }
      export_my_data: { Args: never; Returns: Json }
      get_deck: {
        Args: { p_limit?: number; p_pet_id: string }
        Returns: {
          age_months: number
          breed: string
          distance_km: number
          intents: Database["public"]["Enums"]["pet_intent"][]
          is_mixed: boolean
          name: string
          owner_id: string
          owner_name: string
          pet_id: string
          photos: string[]
          sex: Database["public"]["Enums"]["pet_sex"]
          size: Database["public"]["Enums"]["pet_size"]
          species: Database["public"]["Enums"]["pet_species"]
          super_pawed_you: boolean
          tags: Database["public"]["Enums"]["pet_tag"][]
          verified: boolean
          why: string[]
        }[]
      }
      get_inbox: {
        Args: never
        Returns: {
          conversation_id: string
          last_message_at: string
          last_message_preview: string
          match_id: string
          matched_at: string
          my_pet_id: string
          my_pet_name: string
          other_owner_id: string
          other_owner_name: string
          other_pet_id: string
          other_pet_name: string
          other_pet_photo: string
          unread: boolean
        }[]
      }
      get_moderation_queue: {
        Args: { p_status?: Database["public"]["Enums"]["report_status"] }
        Returns: {
          created_at: string
          details: string
          message_snapshot: string
          open_reports_against_target: number
          reason: Database["public"]["Enums"]["report_reason"]
          report_id: string
          reporter_id: string
          reporter_name: string
          status: Database["public"]["Enums"]["report_status"]
          target_owner_id: string
          target_owner_name: string
          target_owner_status: Database["public"]["Enums"]["owner_status"]
          target_pet_id: string
          target_pet_name: string
        }[]
      }
      get_my_blocks: {
        Args: never
        Returns: {
          blocked_at: string
          blocked_id: string
          owner_name: string
          pet_name: string
        }[]
      }
      get_my_reports: {
        Args: never
        Returns: {
          created_at: string
          details: string
          owner_name: string
          pet_name: string
          reason: Database["public"]["Enums"]["report_reason"]
          report_id: string
          status: Database["public"]["Enums"]["report_status"]
        }[]
      }
      get_pet_profile: {
        Args: { p_pet_id: string; p_viewer_pet_id: string }
        Returns: {
          age_months: number
          breed: string
          distance_km: number
          intents: Database["public"]["Enums"]["pet_intent"][]
          is_matched: boolean
          is_mixed: boolean
          name: string
          owner_id: string
          owner_name: string
          pet_id: string
          photos: string[]
          sex: Database["public"]["Enums"]["pet_sex"]
          size: Database["public"]["Enums"]["pet_size"]
          species: Database["public"]["Enums"]["pet_species"]
          tags: Database["public"]["Enums"]["pet_tag"][]
          verified: boolean
          why: string[]
        }[]
      }
      get_swipe_state: { Args: { p_pet_id: string }; Returns: Json }
      mark_conversation_read: {
        Args: { p_conversation_id: string }
        Returns: undefined
      }
      resolve_report: {
        Args: { p_action: string; p_report_id: string }
        Returns: undefined
      }
      respond_playdate: {
        Args: { p_accept: boolean; p_message_id: string }
        Returns: Json
      }
      rewind_last_swipe: { Args: { p_from_pet_id: string }; Returns: Json }
      set_pet_photos: {
        Args: { p_paths: string[]; p_pet_id: string }
        Returns: string[]
      }
      set_pet_tags: {
        Args: {
          p_pet_id: string
          p_tags: Database["public"]["Enums"]["pet_tag"][]
        }
        Returns: undefined
      }
      swipe: {
        Args: {
          p_action: Database["public"]["Enums"]["swipe_action"]
          p_from_pet_id: string
          p_to_pet_id: string
        }
        Returns: Json
      }
      unmatch: { Args: { p_match_id: string }; Returns: undefined }
      unsuspend_owner: { Args: { p_owner_id: string }; Returns: undefined }
    }
    Enums: {
      match_status: "active" | "unmatched"
      message_kind: "text" | "photo" | "playdate_proposal"
      owner_role: "user" | "moderator"
      owner_status: "active" | "suspended"
      pet_intent: "playdate" | "walking_buddy" | "friendship"
      pet_sex: "male" | "female"
      pet_size: "small" | "medium" | "large"
      pet_species: "dog" | "cat"
      pet_tag:
        | "playful"
        | "energetic"
        | "calm"
        | "couch_potato"
        | "friendly"
        | "shy"
        | "gentle"
        | "curious"
        | "cuddly"
        | "independent"
        | "vocal"
        | "loves_walks"
        | "loves_fetch"
        | "good_with_dogs"
        | "good_with_cats"
        | "good_with_kids"
      report_reason:
        | "harassment"
        | "scam"
        | "animal_welfare"
        | "sexual_content_involving_animals"
        | "impersonation"
        | "spam"
      report_status: "open" | "dismissed" | "actioned"
      swipe_action: "pass" | "like" | "super"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
      match_status: ["active", "unmatched"],
      message_kind: ["text", "photo", "playdate_proposal"],
      owner_role: ["user", "moderator"],
      owner_status: ["active", "suspended"],
      pet_intent: ["playdate", "walking_buddy", "friendship"],
      pet_sex: ["male", "female"],
      pet_size: ["small", "medium", "large"],
      pet_species: ["dog", "cat"],
      pet_tag: [
        "playful",
        "energetic",
        "calm",
        "couch_potato",
        "friendly",
        "shy",
        "gentle",
        "curious",
        "cuddly",
        "independent",
        "vocal",
        "loves_walks",
        "loves_fetch",
        "good_with_dogs",
        "good_with_cats",
        "good_with_kids",
      ],
      report_reason: [
        "harassment",
        "scam",
        "animal_welfare",
        "sexual_content_involving_animals",
        "impersonation",
        "spam",
      ],
      report_status: ["open", "dismissed", "actioned"],
      swipe_action: ["pass", "like", "super"],
    },
  },
} as const
