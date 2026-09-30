export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      agency_facilities: {
        Row: {
          address_line1: string | null
          address_line2: string | null
          agency_organisation_id: string
          agency_organisation_type: Database["public"]["Enums"]["organisation_type"]
          country_code: string | null
          created_at: string
          created_by_profile_id: string | null
          email: string | null
          external_reference: string | null
          facility_type_key: string
          id: string
          linked_facility_organisation_id: string | null
          linked_facility_organisation_type:
            | Database["public"]["Enums"]["organisation_type"]
            | null
          locality: string | null
          name: string
          phone: string | null
          postal_code: string | null
          region: string | null
          status: Database["public"]["Enums"]["facility_status"]
          timezone: string
          updated_at: string
        }
        Insert: {
          address_line1?: string | null
          address_line2?: string | null
          agency_organisation_id: string
          agency_organisation_type?: Database["public"]["Enums"]["organisation_type"]
          country_code?: string | null
          created_at?: string
          created_by_profile_id?: string | null
          email?: string | null
          external_reference?: string | null
          facility_type_key: string
          id?: string
          linked_facility_organisation_id?: string | null
          linked_facility_organisation_type?:
            | Database["public"]["Enums"]["organisation_type"]
            | null
          locality?: string | null
          name: string
          phone?: string | null
          postal_code?: string | null
          region?: string | null
          status?: Database["public"]["Enums"]["facility_status"]
          timezone: string
          updated_at?: string
        }
        Update: {
          address_line1?: string | null
          address_line2?: string | null
          agency_organisation_id?: string
          agency_organisation_type?: Database["public"]["Enums"]["organisation_type"]
          country_code?: string | null
          created_at?: string
          created_by_profile_id?: string | null
          email?: string | null
          external_reference?: string | null
          facility_type_key?: string
          id?: string
          linked_facility_organisation_id?: string | null
          linked_facility_organisation_type?:
            | Database["public"]["Enums"]["organisation_type"]
            | null
          locality?: string | null
          name?: string
          phone?: string | null
          postal_code?: string | null
          region?: string | null
          status?: Database["public"]["Enums"]["facility_status"]
          timezone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agency_facilities_agency_organisation_id_agency_organisati_fkey"
            columns: ["agency_organisation_id", "agency_organisation_type"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id", "type"]
          },
          {
            foreignKeyName: "agency_facilities_created_by_profile_id_fkey"
            columns: ["created_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agency_facilities_facility_type_key_fkey"
            columns: ["facility_type_key"]
            isOneToOne: false
            referencedRelation: "facility_types"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "agency_facilities_linked_facility_organisation_id_linked_f_fkey"
            columns: [
              "linked_facility_organisation_id",
              "linked_facility_organisation_type",
            ]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id", "type"]
          },
        ]
      }
      agency_facility_relationships: {
        Row: {
          agency_facility_id: string
          agency_organisation_id: string
          created_at: string
          created_by_profile_id: string | null
          ended_at: string | null
          id: string
          started_at: string | null
          status: Database["public"]["Enums"]["relationship_status"]
          status_changed_at: string
          updated_at: string
        }
        Insert: {
          agency_facility_id: string
          agency_organisation_id: string
          created_at?: string
          created_by_profile_id?: string | null
          ended_at?: string | null
          id?: string
          started_at?: string | null
          status?: Database["public"]["Enums"]["relationship_status"]
          status_changed_at?: string
          updated_at?: string
        }
        Update: {
          agency_facility_id?: string
          agency_organisation_id?: string
          created_at?: string
          created_by_profile_id?: string | null
          ended_at?: string | null
          id?: string
          started_at?: string | null
          status?: Database["public"]["Enums"]["relationship_status"]
          status_changed_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agency_facility_relationships_agency_facility_id_agency_or_fkey"
            columns: ["agency_facility_id", "agency_organisation_id"]
            isOneToOne: false
            referencedRelation: "agency_facilities"
            referencedColumns: ["id", "agency_organisation_id"]
          },
          {
            foreignKeyName: "agency_facility_relationships_created_by_profile_id_fkey"
            columns: ["created_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      agency_worker_notes: {
        Row: {
          agency_organisation_id: string
          author_profile_id: string | null
          body: string
          created_at: string
          id: string
          worker_id: string
        }
        Insert: {
          agency_organisation_id: string
          author_profile_id?: string | null
          body: string
          created_at?: string
          id?: string
          worker_id: string
        }
        Update: {
          agency_organisation_id?: string
          author_profile_id?: string | null
          body?: string
          created_at?: string
          id?: string
          worker_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agency_worker_notes_author_profile_id_fkey"
            columns: ["author_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agency_worker_notes_worker_id_agency_organisation_id_fkey"
            columns: ["worker_id", "agency_organisation_id"]
            isOneToOne: false
            referencedRelation: "agency_workers"
            referencedColumns: ["id", "agency_organisation_id"]
          },
        ]
      }
      agency_workers: {
        Row: {
          agency_organisation_id: string
          agency_organisation_type: Database["public"]["Enums"]["organisation_type"]
          created_at: string
          end_date: string | null
          id: string
          membership_id: string
          profile_id: string
          start_date: string | null
          status: Database["public"]["Enums"]["worker_status"]
          status_changed_at: string
          updated_at: string
          worker_reference: string | null
        }
        Insert: {
          agency_organisation_id: string
          agency_organisation_type?: Database["public"]["Enums"]["organisation_type"]
          created_at?: string
          end_date?: string | null
          id?: string
          membership_id: string
          profile_id: string
          start_date?: string | null
          status?: Database["public"]["Enums"]["worker_status"]
          status_changed_at?: string
          updated_at?: string
          worker_reference?: string | null
        }
        Update: {
          agency_organisation_id?: string
          agency_organisation_type?: Database["public"]["Enums"]["organisation_type"]
          created_at?: string
          end_date?: string | null
          id?: string
          membership_id?: string
          profile_id?: string
          start_date?: string | null
          status?: Database["public"]["Enums"]["worker_status"]
          status_changed_at?: string
          updated_at?: string
          worker_reference?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agency_workers_agency_organisation_id_agency_organisation__fkey"
            columns: ["agency_organisation_id", "agency_organisation_type"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id", "type"]
          },
          {
            foreignKeyName: "agency_workers_membership_id_agency_organisation_id_profil_fkey"
            columns: ["membership_id", "agency_organisation_id", "profile_id"]
            isOneToOne: false
            referencedRelation: "organisation_memberships"
            referencedColumns: ["id", "organisation_id", "profile_id"]
          },
          {
            foreignKeyName: "agency_workers_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_events: {
        Row: {
          action: string
          actor_aal: string | null
          actor_membership_id: string | null
          actor_profile_id: string | null
          id: string
          metadata: Json
          occurred_at: string
          organisation_id: string | null
          request_id: string | null
          target_id: string | null
          target_type: string | null
        }
        Insert: {
          action: string
          actor_aal?: string | null
          actor_membership_id?: string | null
          actor_profile_id?: string | null
          id?: string
          metadata?: Json
          occurred_at?: string
          organisation_id?: string | null
          request_id?: string | null
          target_id?: string | null
          target_type?: string | null
        }
        Update: {
          action?: string
          actor_aal?: string | null
          actor_membership_id?: string | null
          actor_profile_id?: string | null
          id?: string
          metadata?: Json
          occurred_at?: string
          organisation_id?: string | null
          request_id?: string | null
          target_id?: string | null
          target_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_events_actor_membership_id_organisation_id_fkey"
            columns: ["actor_membership_id", "organisation_id"]
            isOneToOne: false
            referencedRelation: "organisation_memberships"
            referencedColumns: ["id", "organisation_id"]
          },
          {
            foreignKeyName: "audit_events_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      capabilities: {
        Row: {
          created_at: string
          description: string
          is_privileged: boolean
          key: string
        }
        Insert: {
          created_at?: string
          description: string
          is_privileged?: boolean
          key: string
        }
        Update: {
          created_at?: string
          description?: string
          is_privileged?: boolean
          key?: string
        }
        Relationships: []
      }
      facility_locations: {
        Row: {
          address_line1: string | null
          agency_facility_id: string
          agency_organisation_id: string
          created_at: string
          id: string
          locality: string | null
          name: string
          postal_code: string | null
          status: Database["public"]["Enums"]["facility_location_status"]
          timezone: string
          updated_at: string
        }
        Insert: {
          address_line1?: string | null
          agency_facility_id: string
          agency_organisation_id: string
          created_at?: string
          id?: string
          locality?: string | null
          name: string
          postal_code?: string | null
          status?: Database["public"]["Enums"]["facility_location_status"]
          timezone: string
          updated_at?: string
        }
        Update: {
          address_line1?: string | null
          agency_facility_id?: string
          agency_organisation_id?: string
          created_at?: string
          id?: string
          locality?: string | null
          name?: string
          postal_code?: string | null
          status?: Database["public"]["Enums"]["facility_location_status"]
          timezone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "facility_locations_agency_facility_id_agency_organisation__fkey"
            columns: ["agency_facility_id", "agency_organisation_id"]
            isOneToOne: false
            referencedRelation: "agency_facilities"
            referencedColumns: ["id", "agency_organisation_id"]
          },
        ]
      }
      facility_types: {
        Row: {
          created_at: string
          description: string
          is_active: boolean
          key: string
          name: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          description: string
          is_active?: boolean
          key: string
          name: string
          sort_order: number
        }
        Update: {
          created_at?: string
          description?: string
          is_active?: boolean
          key?: string
          name?: string
          sort_order?: number
        }
        Relationships: []
      }
      membership_roles: {
        Row: {
          granted_at: string
          granted_by_profile_id: string | null
          id: string
          membership_id: string
          organisation_id: string
          organisation_type: Database["public"]["Enums"]["organisation_type"]
          revoked_at: string | null
          revoked_by_profile_id: string | null
          role_key: string
        }
        Insert: {
          granted_at?: string
          granted_by_profile_id?: string | null
          id?: string
          membership_id: string
          organisation_id: string
          organisation_type: Database["public"]["Enums"]["organisation_type"]
          revoked_at?: string | null
          revoked_by_profile_id?: string | null
          role_key: string
        }
        Update: {
          granted_at?: string
          granted_by_profile_id?: string | null
          id?: string
          membership_id?: string
          organisation_id?: string
          organisation_type?: Database["public"]["Enums"]["organisation_type"]
          revoked_at?: string | null
          revoked_by_profile_id?: string | null
          role_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "membership_roles_granted_by_profile_id_fkey"
            columns: ["granted_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "membership_roles_membership_id_organisation_id_fkey"
            columns: ["membership_id", "organisation_id"]
            isOneToOne: false
            referencedRelation: "organisation_memberships"
            referencedColumns: ["id", "organisation_id"]
          },
          {
            foreignKeyName: "membership_roles_organisation_id_organisation_type_fkey"
            columns: ["organisation_id", "organisation_type"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id", "type"]
          },
          {
            foreignKeyName: "membership_roles_revoked_by_profile_id_fkey"
            columns: ["revoked_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "membership_roles_role_key_organisation_type_fkey"
            columns: ["role_key", "organisation_type"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["key", "organisation_type"]
          },
        ]
      }
      organisation_invites: {
        Row: {
          accepted_at: string | null
          accepted_by_profile_id: string | null
          created_at: string
          delivery_attempted_at: string | null
          delivery_error_code: string | null
          delivery_message_id: string | null
          delivery_provider: string | null
          delivery_status: Database["public"]["Enums"]["invite_delivery_status"]
          email: string
          expires_at: string
          id: string
          invited_by_profile_id: string | null
          issued_by_platform: boolean
          last_sent_at: string
          organisation_id: string
          organisation_type: Database["public"]["Enums"]["organisation_type"]
          revoked_at: string | null
          revoked_by_profile_id: string | null
          role_key: string
          send_count: number
          status: Database["public"]["Enums"]["invite_status"]
          token_hash: string
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by_profile_id?: string | null
          created_at?: string
          delivery_attempted_at?: string | null
          delivery_error_code?: string | null
          delivery_message_id?: string | null
          delivery_provider?: string | null
          delivery_status?: Database["public"]["Enums"]["invite_delivery_status"]
          email: string
          expires_at: string
          id?: string
          invited_by_profile_id?: string | null
          issued_by_platform?: boolean
          last_sent_at?: string
          organisation_id: string
          organisation_type: Database["public"]["Enums"]["organisation_type"]
          revoked_at?: string | null
          revoked_by_profile_id?: string | null
          role_key: string
          send_count?: number
          status?: Database["public"]["Enums"]["invite_status"]
          token_hash: string
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by_profile_id?: string | null
          created_at?: string
          delivery_attempted_at?: string | null
          delivery_error_code?: string | null
          delivery_message_id?: string | null
          delivery_provider?: string | null
          delivery_status?: Database["public"]["Enums"]["invite_delivery_status"]
          email?: string
          expires_at?: string
          id?: string
          invited_by_profile_id?: string | null
          issued_by_platform?: boolean
          last_sent_at?: string
          organisation_id?: string
          organisation_type?: Database["public"]["Enums"]["organisation_type"]
          revoked_at?: string | null
          revoked_by_profile_id?: string | null
          role_key?: string
          send_count?: number
          status?: Database["public"]["Enums"]["invite_status"]
          token_hash?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organisation_invites_accepted_by_profile_id_fkey"
            columns: ["accepted_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organisation_invites_invited_by_profile_id_fkey"
            columns: ["invited_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organisation_invites_organisation_id_organisation_type_fkey"
            columns: ["organisation_id", "organisation_type"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id", "type"]
          },
          {
            foreignKeyName: "organisation_invites_revoked_by_profile_id_fkey"
            columns: ["revoked_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organisation_invites_role_key_organisation_type_fkey"
            columns: ["role_key", "organisation_type"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["key", "organisation_type"]
          },
        ]
      }
      organisation_memberships: {
        Row: {
          created_at: string
          id: string
          organisation_id: string
          profile_id: string
          status: Database["public"]["Enums"]["membership_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          organisation_id: string
          profile_id: string
          status?: Database["public"]["Enums"]["membership_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          organisation_id?: string
          profile_id?: string
          status?: Database["public"]["Enums"]["membership_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organisation_memberships_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organisation_memberships_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      organisations: {
        Row: {
          created_at: string
          created_by_profile_id: string | null
          id: string
          name: string
          slug: string
          status: Database["public"]["Enums"]["organisation_status"]
          type: Database["public"]["Enums"]["organisation_type"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id?: string | null
          id?: string
          name: string
          slug: string
          status?: Database["public"]["Enums"]["organisation_status"]
          type: Database["public"]["Enums"]["organisation_type"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string | null
          id?: string
          name?: string
          slug?: string
          status?: Database["public"]["Enums"]["organisation_status"]
          type?: Database["public"]["Enums"]["organisation_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organisations_created_by_profile_id_fkey"
            columns: ["created_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_admins: {
        Row: {
          grant_reason: string
          granted_at: string
          granted_by: string
          id: string
          profile_id: string
          revoke_reason: string | null
          revoked_at: string | null
          revoked_by: string | null
        }
        Insert: {
          grant_reason: string
          granted_at?: string
          granted_by: string
          id?: string
          profile_id: string
          revoke_reason?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
        }
        Update: {
          grant_reason?: string
          granted_at?: string
          granted_by?: string
          id?: string
          profile_id?: string
          revoke_reason?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "platform_admins_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          id: string
          status: Database["public"]["Enums"]["profile_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          id: string
          status?: Database["public"]["Enums"]["profile_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          id?: string
          status?: Database["public"]["Enums"]["profile_status"]
          updated_at?: string
        }
        Relationships: []
      }
      role_capabilities: {
        Row: {
          capability_key: string
          role_key: string
        }
        Insert: {
          capability_key: string
          role_key: string
        }
        Update: {
          capability_key?: string
          role_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_capabilities_capability_key_fkey"
            columns: ["capability_key"]
            isOneToOne: false
            referencedRelation: "capabilities"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "role_capabilities_role_key_fkey"
            columns: ["role_key"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["key"]
          },
        ]
      }
      roles: {
        Row: {
          created_at: string
          description: string
          is_owner_role: boolean
          key: string
          name: string
          organisation_type: Database["public"]["Enums"]["organisation_type"]
        }
        Insert: {
          created_at?: string
          description: string
          is_owner_role?: boolean
          key: string
          name: string
          organisation_type: Database["public"]["Enums"]["organisation_type"]
        }
        Update: {
          created_at?: string
          description?: string
          is_owner_role?: boolean
          key?: string
          name?: string
          organisation_type?: Database["public"]["Enums"]["organisation_type"]
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_organisation_invite: {
        Args: { p_token: string }
        Returns: {
          membership_id: string
          organisation_id: string
        }[]
      }
      add_agency_worker_note: {
        Args: { p_body: string; p_worker_id: string }
        Returns: string
      }
      assign_membership_role: {
        Args: { p_membership_id: string; p_role_key: string }
        Returns: string
      }
      create_agency_facility: {
        Args: {
          p_address_line1?: string
          p_address_line2?: string
          p_agency_organisation_id: string
          p_country_code?: string
          p_email?: string
          p_external_reference?: string
          p_facility_type: string
          p_locality?: string
          p_name: string
          p_phone?: string
          p_postal_code?: string
          p_region?: string
          p_timezone: string
        }
        Returns: string
      }
      create_facility_location: {
        Args: {
          p_address_line1?: string
          p_facility_id: string
          p_locality?: string
          p_name: string
          p_postal_code?: string
          p_timezone?: string
        }
        Returns: string
      }
      create_facility_relationship: {
        Args: { p_facility_id: string }
        Returns: string
      }
      create_organisation: {
        Args: {
          p_name: string
          p_slug: string
          p_type: Database["public"]["Enums"]["organisation_type"]
        }
        Returns: string
      }
      create_organisation_invite: {
        Args: { p_email: string; p_organisation_id: string; p_role_key: string }
        Returns: {
          invite_expires_at: string
          invite_id: string
          invite_token: string
        }[]
      }
      list_organisation_invites: {
        Args: { p_organisation_id: string }
        Returns: {
          invite_delivery_status: Database["public"]["Enums"]["invite_delivery_status"]
          invite_expires_at: string
          invite_id: string
          invite_role_key: string
          invite_send_count: number
          invite_status: Database["public"]["Enums"]["invite_status"]
          invited_at: string
          invitee_email: string
        }[]
      }
      list_partner_agency_relationships: {
        Args: { p_facility_organisation_id: string }
        Returns: {
          agency_name: string
          agency_organisation_id: string
          relationship_id: string
          relationship_started_at: string
          relationship_status: Database["public"]["Enums"]["relationship_status"]
        }[]
      }
      my_capabilities: {
        Args: { p_organisation_id: string }
        Returns: {
          capability_key: string
          is_privileged: boolean
          is_satisfied: boolean
        }[]
      }
      platform_create_organisation: {
        Args: {
          p_name: string
          p_owner_email: string
          p_slug: string
          p_type: Database["public"]["Enums"]["organisation_type"]
        }
        Returns: {
          invite_expires_at: string
          invite_id: string
          invite_token: string
          organisation_id: string
        }[]
      }
      platform_link_agency_facility: {
        Args: {
          p_agency_facility_id: string
          p_facility_organisation_id: string
        }
        Returns: undefined
      }
      platform_list_organisations: {
        Args: never
        Returns: {
          active_member_count: number
          organisation_created_at: string
          organisation_id: string
          organisation_name: string
          organisation_slug: string
          organisation_status: Database["public"]["Enums"]["organisation_status"]
          organisation_type: Database["public"]["Enums"]["organisation_type"]
        }[]
      }
      platform_set_organisation_status: {
        Args: {
          p_organisation_id: string
          p_status: Database["public"]["Enums"]["organisation_status"]
        }
        Returns: undefined
      }
      platform_set_profile_status: {
        Args: {
          p_profile_id: string
          p_status: Database["public"]["Enums"]["profile_status"]
        }
        Returns: undefined
      }
      preview_organisation_invite: {
        Args: { p_token: string }
        Returns: {
          invite_expires_at: string
          organisation_id: string
          organisation_name: string
          organisation_type: Database["public"]["Enums"]["organisation_type"]
          role_key: string
          role_name: string
        }[]
      }
      record_organisation_invite_delivery: {
        Args: {
          p_error_code?: string
          p_invite_id: string
          p_message_id?: string
          p_provider: string
          p_status: Database["public"]["Enums"]["invite_delivery_status"]
        }
        Returns: undefined
      }
      resend_organisation_invite: {
        Args: { p_invite_id: string }
        Returns: {
          invite_expires_at: string
          invite_id: string
          invite_token: string
        }[]
      }
      revoke_membership_role: {
        Args: { p_membership_id: string; p_role_key: string }
        Returns: undefined
      }
      revoke_organisation_invite: {
        Args: { p_invite_id: string }
        Returns: undefined
      }
      set_agency_facility_status: {
        Args: {
          p_facility_id: string
          p_status: Database["public"]["Enums"]["facility_status"]
        }
        Returns: undefined
      }
      set_agency_worker_status: {
        Args: {
          p_status: Database["public"]["Enums"]["worker_status"]
          p_worker_id: string
        }
        Returns: undefined
      }
      set_facility_relationship_status: {
        Args: {
          p_relationship_id: string
          p_status: Database["public"]["Enums"]["relationship_status"]
        }
        Returns: undefined
      }
      set_membership_status: {
        Args: {
          p_membership_id: string
          p_status: Database["public"]["Enums"]["membership_status"]
        }
        Returns: undefined
      }
      update_agency_facility: {
        Args: {
          p_address_line1?: string
          p_address_line2?: string
          p_country_code?: string
          p_email?: string
          p_external_reference?: string
          p_facility_id: string
          p_facility_type: string
          p_locality?: string
          p_name: string
          p_phone?: string
          p_postal_code?: string
          p_region?: string
          p_timezone: string
        }
        Returns: undefined
      }
      update_agency_worker: {
        Args: { p_worker_id: string; p_worker_reference: string }
        Returns: undefined
      }
    }
    Enums: {
      facility_location_status: "active" | "inactive"
      facility_status: "active" | "inactive" | "archived"
      invite_delivery_status: "not_attempted" | "sent" | "failed" | "skipped"
      invite_status: "pending" | "accepted" | "revoked"
      membership_status: "active" | "suspended" | "revoked"
      organisation_status: "active" | "suspended" | "archived"
      organisation_type: "agency" | "facility"
      profile_status: "active" | "suspended"
      relationship_status: "pending" | "active" | "suspended" | "ended"
      worker_status:
        | "onboarding"
        | "active"
        | "inactive"
        | "suspended"
        | "terminated"
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
      facility_location_status: ["active", "inactive"],
      facility_status: ["active", "inactive", "archived"],
      invite_delivery_status: ["not_attempted", "sent", "failed", "skipped"],
      invite_status: ["pending", "accepted", "revoked"],
      membership_status: ["active", "suspended", "revoked"],
      organisation_status: ["active", "suspended", "archived"],
      organisation_type: ["agency", "facility"],
      profile_status: ["active", "suspended"],
      relationship_status: ["pending", "active", "suspended", "ended"],
      worker_status: [
        "onboarding",
        "active",
        "inactive",
        "suspended",
        "terminated",
      ],
    },
  },
} as const
