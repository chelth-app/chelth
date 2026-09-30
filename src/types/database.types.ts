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
      agency_worker_disciplines: {
        Row: {
          agency_organisation_id: string
          agency_worker_id: string
          assigned_at: string
          assigned_by_profile_id: string | null
          discipline_key: string
        }
        Insert: {
          agency_organisation_id: string
          agency_worker_id: string
          assigned_at?: string
          assigned_by_profile_id?: string | null
          discipline_key: string
        }
        Update: {
          agency_organisation_id?: string
          agency_worker_id?: string
          assigned_at?: string
          assigned_by_profile_id?: string | null
          discipline_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "agency_worker_disciplines_agency_worker_id_agency_organisa_fkey"
            columns: ["agency_worker_id", "agency_organisation_id"]
            isOneToOne: false
            referencedRelation: "agency_workers"
            referencedColumns: ["id", "agency_organisation_id"]
          },
          {
            foreignKeyName: "agency_worker_disciplines_assigned_by_profile_id_fkey"
            columns: ["assigned_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agency_worker_disciplines_discipline_key_fkey"
            columns: ["discipline_key"]
            isOneToOne: false
            referencedRelation: "disciplines"
            referencedColumns: ["key"]
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
      assignment_eligibility_decisions: {
        Row: {
          actor_membership_id: string
          agency_organisation_id: string
          agency_worker_id: string
          assignment_id: string | null
          block_reasons: Database["public"]["Enums"]["assignment_block_reason"][]
          compliance_findings: Json
          compliance_reasons: Database["public"]["Enums"]["compliance_reason"][]
          decided_at: string
          engine_version: string
          evaluation_dates: string[]
          id: string
          outcome: Database["public"]["Enums"]["assignment_decision_outcome"]
          readiness: Database["public"]["Enums"]["readiness_status"]
          sequence: number
          shift_id: string
        }
        Insert: {
          actor_membership_id: string
          agency_organisation_id: string
          agency_worker_id: string
          assignment_id?: string | null
          block_reasons?: Database["public"]["Enums"]["assignment_block_reason"][]
          compliance_findings?: Json
          compliance_reasons?: Database["public"]["Enums"]["compliance_reason"][]
          decided_at?: string
          engine_version: string
          evaluation_dates: string[]
          id?: string
          outcome: Database["public"]["Enums"]["assignment_decision_outcome"]
          readiness: Database["public"]["Enums"]["readiness_status"]
          sequence?: never
          shift_id: string
        }
        Update: {
          actor_membership_id?: string
          agency_organisation_id?: string
          agency_worker_id?: string
          assignment_id?: string | null
          block_reasons?: Database["public"]["Enums"]["assignment_block_reason"][]
          compliance_findings?: Json
          compliance_reasons?: Database["public"]["Enums"]["compliance_reason"][]
          decided_at?: string
          engine_version?: string
          evaluation_dates?: string[]
          id?: string
          outcome?: Database["public"]["Enums"]["assignment_decision_outcome"]
          readiness?: Database["public"]["Enums"]["readiness_status"]
          sequence?: never
          shift_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "assignment_eligibility_decisi_actor_membership_id_agency_o_fkey"
            columns: ["actor_membership_id", "agency_organisation_id"]
            isOneToOne: false
            referencedRelation: "organisation_memberships"
            referencedColumns: ["id", "organisation_id"]
          },
          {
            foreignKeyName: "assignment_eligibility_decisi_agency_worker_id_agency_orga_fkey"
            columns: ["agency_worker_id", "agency_organisation_id"]
            isOneToOne: false
            referencedRelation: "agency_workers"
            referencedColumns: ["id", "agency_organisation_id"]
          },
          {
            foreignKeyName: "assignment_eligibility_decisi_assignment_id_agency_organis_fkey"
            columns: ["assignment_id", "agency_organisation_id"]
            isOneToOne: false
            referencedRelation: "shift_assignments"
            referencedColumns: ["id", "agency_organisation_id"]
          },
          {
            foreignKeyName: "assignment_eligibility_decisi_shift_id_agency_organisation_fkey"
            columns: ["shift_id", "agency_organisation_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id", "agency_organisation_id"]
          },
        ]
      }
      assignment_issues: {
        Row: {
          agency_organisation_id: string
          assignment_id: string
          block_reasons: Database["public"]["Enums"]["assignment_block_reason"][]
          compliance_reasons: Database["public"]["Enums"]["compliance_reason"][]
          detected_by: Database["public"]["Enums"]["assignment_issue_source"]
          id: string
          issue_type: Database["public"]["Enums"]["assignment_issue_type"]
          last_evaluated_at: string
          opened_at: string
          resolution:
            | Database["public"]["Enums"]["assignment_issue_resolution"]
            | null
          resolved_at: string | null
          severity: Database["public"]["Enums"]["assignment_issue_severity"]
          shift_id: string
          status: Database["public"]["Enums"]["assignment_issue_status"]
        }
        Insert: {
          agency_organisation_id: string
          assignment_id: string
          block_reasons?: Database["public"]["Enums"]["assignment_block_reason"][]
          compliance_reasons?: Database["public"]["Enums"]["compliance_reason"][]
          detected_by: Database["public"]["Enums"]["assignment_issue_source"]
          id?: string
          issue_type: Database["public"]["Enums"]["assignment_issue_type"]
          last_evaluated_at?: string
          opened_at?: string
          resolution?:
            | Database["public"]["Enums"]["assignment_issue_resolution"]
            | null
          resolved_at?: string | null
          severity: Database["public"]["Enums"]["assignment_issue_severity"]
          shift_id: string
          status?: Database["public"]["Enums"]["assignment_issue_status"]
        }
        Update: {
          agency_organisation_id?: string
          assignment_id?: string
          block_reasons?: Database["public"]["Enums"]["assignment_block_reason"][]
          compliance_reasons?: Database["public"]["Enums"]["compliance_reason"][]
          detected_by?: Database["public"]["Enums"]["assignment_issue_source"]
          id?: string
          issue_type?: Database["public"]["Enums"]["assignment_issue_type"]
          last_evaluated_at?: string
          opened_at?: string
          resolution?:
            | Database["public"]["Enums"]["assignment_issue_resolution"]
            | null
          resolved_at?: string | null
          severity?: Database["public"]["Enums"]["assignment_issue_severity"]
          shift_id?: string
          status?: Database["public"]["Enums"]["assignment_issue_status"]
        }
        Relationships: [
          {
            foreignKeyName: "assignment_issues_assignment_id_agency_organisation_id_fkey"
            columns: ["assignment_id", "agency_organisation_id"]
            isOneToOne: false
            referencedRelation: "shift_assignments"
            referencedColumns: ["id", "agency_organisation_id"]
          },
          {
            foreignKeyName: "assignment_issues_shift_id_agency_organisation_id_fkey"
            columns: ["shift_id", "agency_organisation_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id", "agency_organisation_id"]
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
      credential_documents: {
        Row: {
          created_at: string
          credential_id: string
          credential_version_id: string
          declared_size_bytes: number
          id: string
          mime_type: string
          profile_id: string
          sha256: string | null
          status: Database["public"]["Enums"]["document_status"]
          status_changed_at: string
          status_reason: string | null
          storage_path: string | null
        }
        Insert: {
          created_at?: string
          credential_id: string
          credential_version_id: string
          declared_size_bytes: number
          id?: string
          mime_type: string
          profile_id: string
          sha256?: string | null
          status?: Database["public"]["Enums"]["document_status"]
          status_changed_at?: string
          status_reason?: string | null
          storage_path?: string | null
        }
        Update: {
          created_at?: string
          credential_id?: string
          credential_version_id?: string
          declared_size_bytes?: number
          id?: string
          mime_type?: string
          profile_id?: string
          sha256?: string | null
          status?: Database["public"]["Enums"]["document_status"]
          status_changed_at?: string
          status_reason?: string | null
          storage_path?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "credential_documents_credential_version_id_credential_id_p_fkey"
            columns: ["credential_version_id", "credential_id", "profile_id"]
            isOneToOne: false
            referencedRelation: "credential_versions"
            referencedColumns: ["id", "credential_id", "profile_id"]
          },
        ]
      }
      credential_identifiers: {
        Row: {
          created_at: string
          credential_id: string
          credential_number: string
          profile_id: string
        }
        Insert: {
          created_at?: string
          credential_id: string
          credential_number: string
          profile_id: string
        }
        Update: {
          created_at?: string
          credential_id?: string
          credential_number?: string
          profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "credential_identifiers_credential_id_profile_id_fkey"
            columns: ["credential_id", "profile_id"]
            isOneToOne: false
            referencedRelation: "credentials"
            referencedColumns: ["id", "profile_id"]
          },
        ]
      }
      credential_requirements: {
        Row: {
          agency_facility_id: string | null
          agency_organisation_id: string
          agency_organisation_type: Database["public"]["Enums"]["organisation_type"]
          created_at: string
          created_by_profile_id: string | null
          credential_type_key: string
          discipline_key: string | null
          effective_from: string
          effective_until: string | null
          expiry_warning_days: number
          id: string
          jurisdiction_code: string | null
          minimum_validity_days: number
          must_be_verified: boolean
          status: Database["public"]["Enums"]["requirement_status"]
          updated_at: string
        }
        Insert: {
          agency_facility_id?: string | null
          agency_organisation_id: string
          agency_organisation_type?: Database["public"]["Enums"]["organisation_type"]
          created_at?: string
          created_by_profile_id?: string | null
          credential_type_key: string
          discipline_key?: string | null
          effective_from?: string
          effective_until?: string | null
          expiry_warning_days?: number
          id?: string
          jurisdiction_code?: string | null
          minimum_validity_days?: number
          must_be_verified?: boolean
          status?: Database["public"]["Enums"]["requirement_status"]
          updated_at?: string
        }
        Update: {
          agency_facility_id?: string | null
          agency_organisation_id?: string
          agency_organisation_type?: Database["public"]["Enums"]["organisation_type"]
          created_at?: string
          created_by_profile_id?: string | null
          credential_type_key?: string
          discipline_key?: string | null
          effective_from?: string
          effective_until?: string | null
          expiry_warning_days?: number
          id?: string
          jurisdiction_code?: string | null
          minimum_validity_days?: number
          must_be_verified?: boolean
          status?: Database["public"]["Enums"]["requirement_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "credential_requirements_agency_facility_id_agency_organisa_fkey"
            columns: ["agency_facility_id", "agency_organisation_id"]
            isOneToOne: false
            referencedRelation: "agency_facilities"
            referencedColumns: ["id", "agency_organisation_id"]
          },
          {
            foreignKeyName: "credential_requirements_agency_organisation_id_agency_orga_fkey"
            columns: ["agency_organisation_id", "agency_organisation_type"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id", "type"]
          },
          {
            foreignKeyName: "credential_requirements_created_by_profile_id_fkey"
            columns: ["created_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credential_requirements_credential_type_key_fkey"
            columns: ["credential_type_key"]
            isOneToOne: false
            referencedRelation: "credential_types"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "credential_requirements_discipline_key_fkey"
            columns: ["discipline_key"]
            isOneToOne: false
            referencedRelation: "disciplines"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "credential_requirements_jurisdiction_code_fkey"
            columns: ["jurisdiction_code"]
            isOneToOne: false
            referencedRelation: "jurisdictions"
            referencedColumns: ["code"]
          },
        ]
      }
      credential_shares: {
        Row: {
          agency_organisation_id: string
          agency_organisation_type: Database["public"]["Enums"]["organisation_type"]
          credential_id: string
          id: string
          membership_id: string
          profile_id: string
          revoked_at: string | null
          shared_at: string
          status: Database["public"]["Enums"]["credential_share_status"]
        }
        Insert: {
          agency_organisation_id: string
          agency_organisation_type?: Database["public"]["Enums"]["organisation_type"]
          credential_id: string
          id?: string
          membership_id: string
          profile_id: string
          revoked_at?: string | null
          shared_at?: string
          status?: Database["public"]["Enums"]["credential_share_status"]
        }
        Update: {
          agency_organisation_id?: string
          agency_organisation_type?: Database["public"]["Enums"]["organisation_type"]
          credential_id?: string
          id?: string
          membership_id?: string
          profile_id?: string
          revoked_at?: string | null
          shared_at?: string
          status?: Database["public"]["Enums"]["credential_share_status"]
        }
        Relationships: [
          {
            foreignKeyName: "credential_shares_agency_organisation_id_agency_organisati_fkey"
            columns: ["agency_organisation_id", "agency_organisation_type"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id", "type"]
          },
          {
            foreignKeyName: "credential_shares_credential_id_profile_id_fkey"
            columns: ["credential_id", "profile_id"]
            isOneToOne: false
            referencedRelation: "credentials"
            referencedColumns: ["id", "profile_id"]
          },
          {
            foreignKeyName: "credential_shares_membership_id_agency_organisation_id_pro_fkey"
            columns: ["membership_id", "agency_organisation_id", "profile_id"]
            isOneToOne: false
            referencedRelation: "organisation_memberships"
            referencedColumns: ["id", "organisation_id", "profile_id"]
          },
        ]
      }
      credential_types: {
        Row: {
          category: Database["public"]["Enums"]["credential_category"]
          created_at: string
          is_active: boolean
          is_renewable: boolean
          jurisdiction_rule: Database["public"]["Enums"]["credential_jurisdiction_rule"]
          key: string
          name: string
          requires_credential_number: boolean
          requires_document: boolean
          requires_expiry_date: boolean
          requires_issue_date: boolean
          requires_verification: boolean
          scope: Database["public"]["Enums"]["credential_scope"]
          sort_order: number
          validity_months: number | null
        }
        Insert: {
          category: Database["public"]["Enums"]["credential_category"]
          created_at?: string
          is_active?: boolean
          is_renewable?: boolean
          jurisdiction_rule?: Database["public"]["Enums"]["credential_jurisdiction_rule"]
          key: string
          name: string
          requires_credential_number?: boolean
          requires_document?: boolean
          requires_expiry_date?: boolean
          requires_issue_date?: boolean
          requires_verification?: boolean
          scope?: Database["public"]["Enums"]["credential_scope"]
          sort_order: number
          validity_months?: number | null
        }
        Update: {
          category?: Database["public"]["Enums"]["credential_category"]
          created_at?: string
          is_active?: boolean
          is_renewable?: boolean
          jurisdiction_rule?: Database["public"]["Enums"]["credential_jurisdiction_rule"]
          key?: string
          name?: string
          requires_credential_number?: boolean
          requires_document?: boolean
          requires_expiry_date?: boolean
          requires_issue_date?: boolean
          requires_verification?: boolean
          scope?: Database["public"]["Enums"]["credential_scope"]
          sort_order?: number
          validity_months?: number | null
        }
        Relationships: []
      }
      credential_verifications: {
        Row: {
          actor_membership_id: string
          agency_facility_id: string | null
          agency_organisation_id: string
          created_at: string
          credential_id: string
          credential_version_id: string
          id: string
          outcome: Database["public"]["Enums"]["verification_outcome"]
          profile_id: string
          rejection_reason:
            | Database["public"]["Enums"]["verification_rejection_reason"]
            | null
          sequence: number
        }
        Insert: {
          actor_membership_id: string
          agency_facility_id?: string | null
          agency_organisation_id: string
          created_at?: string
          credential_id: string
          credential_version_id: string
          id?: string
          outcome: Database["public"]["Enums"]["verification_outcome"]
          profile_id: string
          rejection_reason?:
            | Database["public"]["Enums"]["verification_rejection_reason"]
            | null
          sequence?: never
        }
        Update: {
          actor_membership_id?: string
          agency_facility_id?: string | null
          agency_organisation_id?: string
          created_at?: string
          credential_id?: string
          credential_version_id?: string
          id?: string
          outcome?: Database["public"]["Enums"]["verification_outcome"]
          profile_id?: string
          rejection_reason?:
            | Database["public"]["Enums"]["verification_rejection_reason"]
            | null
          sequence?: never
        }
        Relationships: [
          {
            foreignKeyName: "credential_verifications_actor_membership_id_agency_organi_fkey"
            columns: ["actor_membership_id", "agency_organisation_id"]
            isOneToOne: false
            referencedRelation: "organisation_memberships"
            referencedColumns: ["id", "organisation_id"]
          },
          {
            foreignKeyName: "credential_verifications_agency_facility_id_agency_organis_fkey"
            columns: ["agency_facility_id", "agency_organisation_id"]
            isOneToOne: false
            referencedRelation: "agency_facilities"
            referencedColumns: ["id", "agency_organisation_id"]
          },
          {
            foreignKeyName: "credential_verifications_credential_version_id_credential__fkey"
            columns: ["credential_version_id", "credential_id", "profile_id"]
            isOneToOne: false
            referencedRelation: "credential_versions"
            referencedColumns: ["id", "credential_id", "profile_id"]
          },
        ]
      }
      credential_versions: {
        Row: {
          created_at: string
          credential_id: string
          expiry_date: string | null
          id: string
          issue_date: string | null
          profile_id: string
          status: Database["public"]["Enums"]["credential_version_status"]
          submitted_at: string | null
          updated_at: string
          version_number: number
        }
        Insert: {
          created_at?: string
          credential_id: string
          expiry_date?: string | null
          id?: string
          issue_date?: string | null
          profile_id: string
          status?: Database["public"]["Enums"]["credential_version_status"]
          submitted_at?: string | null
          updated_at?: string
          version_number: number
        }
        Update: {
          created_at?: string
          credential_id?: string
          expiry_date?: string | null
          id?: string
          issue_date?: string | null
          profile_id?: string
          status?: Database["public"]["Enums"]["credential_version_status"]
          submitted_at?: string | null
          updated_at?: string
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "credential_versions_credential_id_profile_id_fkey"
            columns: ["credential_id", "profile_id"]
            isOneToOne: false
            referencedRelation: "credentials"
            referencedColumns: ["id", "profile_id"]
          },
        ]
      }
      credentials: {
        Row: {
          created_at: string
          credential_type_key: string
          id: string
          issuing_authority: string | null
          jurisdiction_code: string | null
          profile_id: string
          status: Database["public"]["Enums"]["credential_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          credential_type_key: string
          id?: string
          issuing_authority?: string | null
          jurisdiction_code?: string | null
          profile_id: string
          status?: Database["public"]["Enums"]["credential_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          credential_type_key?: string
          id?: string
          issuing_authority?: string | null
          jurisdiction_code?: string | null
          profile_id?: string
          status?: Database["public"]["Enums"]["credential_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "credentials_credential_type_key_fkey"
            columns: ["credential_type_key"]
            isOneToOne: false
            referencedRelation: "credential_types"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "credentials_jurisdiction_code_fkey"
            columns: ["jurisdiction_code"]
            isOneToOne: false
            referencedRelation: "jurisdictions"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "credentials_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      disciplines: {
        Row: {
          is_active: boolean
          key: string
          name: string
          sort_order: number
        }
        Insert: {
          is_active?: boolean
          key: string
          name: string
          sort_order: number
        }
        Update: {
          is_active?: boolean
          key?: string
          name?: string
          sort_order?: number
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
      jurisdictions: {
        Row: {
          code: string
          country_code: string
          is_active: boolean
          level: Database["public"]["Enums"]["jurisdiction_level"]
          name: string
          parent_code: string | null
        }
        Insert: {
          code: string
          country_code: string
          is_active?: boolean
          level: Database["public"]["Enums"]["jurisdiction_level"]
          name: string
          parent_code?: string | null
        }
        Update: {
          code?: string
          country_code?: string
          is_active?: boolean
          level?: Database["public"]["Enums"]["jurisdiction_level"]
          name?: string
          parent_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "jurisdictions_parent_code_fkey"
            columns: ["parent_code"]
            isOneToOne: false
            referencedRelation: "jurisdictions"
            referencedColumns: ["code"]
          },
        ]
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
      relationship_worker_compliance_shares: {
        Row: {
          agency_organisation_id: string
          agency_worker_id: string
          id: string
          relationship_id: string
          revoked_at: string | null
          shared_at: string
          shared_by_profile_id: string | null
          status: Database["public"]["Enums"]["compliance_share_status"]
        }
        Insert: {
          agency_organisation_id: string
          agency_worker_id: string
          id?: string
          relationship_id: string
          revoked_at?: string | null
          shared_at?: string
          shared_by_profile_id?: string | null
          status?: Database["public"]["Enums"]["compliance_share_status"]
        }
        Update: {
          agency_organisation_id?: string
          agency_worker_id?: string
          id?: string
          relationship_id?: string
          revoked_at?: string | null
          shared_at?: string
          shared_by_profile_id?: string | null
          status?: Database["public"]["Enums"]["compliance_share_status"]
        }
        Relationships: [
          {
            foreignKeyName: "relationship_worker_complianc_agency_worker_id_agency_orga_fkey"
            columns: ["agency_worker_id", "agency_organisation_id"]
            isOneToOne: false
            referencedRelation: "agency_workers"
            referencedColumns: ["id", "agency_organisation_id"]
          },
          {
            foreignKeyName: "relationship_worker_complianc_relationship_id_agency_organ_fkey"
            columns: ["relationship_id", "agency_organisation_id"]
            isOneToOne: false
            referencedRelation: "agency_facility_relationships"
            referencedColumns: ["id", "agency_organisation_id"]
          },
          {
            foreignKeyName: "relationship_worker_compliance_shares_shared_by_profile_id_fkey"
            columns: ["shared_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
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
      shift_assignments: {
        Row: {
          accepted_at: string | null
          agency_organisation_id: string
          agency_worker_id: string
          assigned_at: string
          assigned_by_membership_id: string
          cancellation_reason:
            | Database["public"]["Enums"]["assignment_cancellation_reason"]
            | null
          cancelled_at: string | null
          cancelled_by_profile_id: string | null
          created_at: string
          declined_at: string | null
          end_at: string
          id: string
          period: unknown
          profile_id: string
          shift_id: string
          start_at: string
          status: Database["public"]["Enums"]["assignment_status"]
          status_changed_at: string
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          agency_organisation_id: string
          agency_worker_id: string
          assigned_at?: string
          assigned_by_membership_id: string
          cancellation_reason?:
            | Database["public"]["Enums"]["assignment_cancellation_reason"]
            | null
          cancelled_at?: string | null
          cancelled_by_profile_id?: string | null
          created_at?: string
          declined_at?: string | null
          end_at: string
          id?: string
          period?: unknown
          profile_id: string
          shift_id: string
          start_at: string
          status?: Database["public"]["Enums"]["assignment_status"]
          status_changed_at?: string
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          agency_organisation_id?: string
          agency_worker_id?: string
          assigned_at?: string
          assigned_by_membership_id?: string
          cancellation_reason?:
            | Database["public"]["Enums"]["assignment_cancellation_reason"]
            | null
          cancelled_at?: string | null
          cancelled_by_profile_id?: string | null
          created_at?: string
          declined_at?: string | null
          end_at?: string
          id?: string
          period?: unknown
          profile_id?: string
          shift_id?: string
          start_at?: string
          status?: Database["public"]["Enums"]["assignment_status"]
          status_changed_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shift_assignments_agency_worker_id_agency_organisation_id__fkey"
            columns: [
              "agency_worker_id",
              "agency_organisation_id",
              "profile_id",
            ]
            isOneToOne: false
            referencedRelation: "agency_workers"
            referencedColumns: ["id", "agency_organisation_id", "profile_id"]
          },
          {
            foreignKeyName: "shift_assignments_assigned_by_membership_id_agency_organis_fkey"
            columns: ["assigned_by_membership_id", "agency_organisation_id"]
            isOneToOne: false
            referencedRelation: "organisation_memberships"
            referencedColumns: ["id", "organisation_id"]
          },
          {
            foreignKeyName: "shift_assignments_cancelled_by_profile_id_fkey"
            columns: ["cancelled_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_assignments_shift_id_agency_organisation_id_start_at_fkey"
            columns: [
              "shift_id",
              "agency_organisation_id",
              "start_at",
              "end_at",
            ]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: [
              "id",
              "agency_organisation_id",
              "start_at",
              "end_at",
            ]
          },
        ]
      }
      shift_internal_notes: {
        Row: {
          agency_organisation_id: string
          author_profile_id: string | null
          body: string
          created_at: string
          id: string
          shift_id: string
        }
        Insert: {
          agency_organisation_id: string
          author_profile_id?: string | null
          body: string
          created_at?: string
          id?: string
          shift_id: string
        }
        Update: {
          agency_organisation_id?: string
          author_profile_id?: string | null
          body?: string
          created_at?: string
          id?: string
          shift_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shift_internal_notes_author_profile_id_fkey"
            columns: ["author_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_internal_notes_shift_id_agency_organisation_id_fkey"
            columns: ["shift_id", "agency_organisation_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id", "agency_organisation_id"]
          },
        ]
      }
      shift_offers: {
        Row: {
          agency_organisation_id: string
          agency_worker_id: string
          assignment_id: string | null
          close_reason:
            | Database["public"]["Enums"]["shift_offer_close_reason"]
            | null
          closed_at: string | null
          created_at: string
          created_by_membership_id: string
          expires_at: string
          id: string
          offered_at: string
          profile_id: string
          responded_at: string | null
          shift_id: string
          status: Database["public"]["Enums"]["shift_offer_status"]
          updated_at: string
        }
        Insert: {
          agency_organisation_id: string
          agency_worker_id: string
          assignment_id?: string | null
          close_reason?:
            | Database["public"]["Enums"]["shift_offer_close_reason"]
            | null
          closed_at?: string | null
          created_at?: string
          created_by_membership_id: string
          expires_at: string
          id?: string
          offered_at?: string
          profile_id: string
          responded_at?: string | null
          shift_id: string
          status?: Database["public"]["Enums"]["shift_offer_status"]
          updated_at?: string
        }
        Update: {
          agency_organisation_id?: string
          agency_worker_id?: string
          assignment_id?: string | null
          close_reason?:
            | Database["public"]["Enums"]["shift_offer_close_reason"]
            | null
          closed_at?: string | null
          created_at?: string
          created_by_membership_id?: string
          expires_at?: string
          id?: string
          offered_at?: string
          profile_id?: string
          responded_at?: string | null
          shift_id?: string
          status?: Database["public"]["Enums"]["shift_offer_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shift_offers_agency_worker_id_agency_organisation_id_profi_fkey"
            columns: [
              "agency_worker_id",
              "agency_organisation_id",
              "profile_id",
            ]
            isOneToOne: false
            referencedRelation: "agency_workers"
            referencedColumns: ["id", "agency_organisation_id", "profile_id"]
          },
          {
            foreignKeyName: "shift_offers_assignment_id_agency_organisation_id_fkey"
            columns: ["assignment_id", "agency_organisation_id"]
            isOneToOne: false
            referencedRelation: "shift_assignments"
            referencedColumns: ["id", "agency_organisation_id"]
          },
          {
            foreignKeyName: "shift_offers_created_by_membership_id_agency_organisation__fkey"
            columns: ["created_by_membership_id", "agency_organisation_id"]
            isOneToOne: false
            referencedRelation: "organisation_memberships"
            referencedColumns: ["id", "organisation_id"]
          },
          {
            foreignKeyName: "shift_offers_shift_id_agency_organisation_id_fkey"
            columns: ["shift_id", "agency_organisation_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id", "agency_organisation_id"]
          },
        ]
      }
      shifts: {
        Row: {
          agency_facility_id: string
          agency_organisation_id: string
          agency_organisation_type: Database["public"]["Enums"]["organisation_type"]
          cancellation_reason:
            | Database["public"]["Enums"]["shift_cancellation_reason"]
            | null
          cancelled_at: string | null
          cancelled_by_profile_id: string | null
          completed_at: string | null
          created_at: string
          created_by_membership_id: string
          created_by_organisation_id: string
          created_by_profile_id: string | null
          discipline_key: string
          end_at: string
          external_reference: string | null
          facility_location_id: string
          id: string
          instructions: string | null
          opened_at: string | null
          opened_by_profile_id: string | null
          relationship_id: string
          requested_headcount: number
          source: Database["public"]["Enums"]["shift_source"]
          start_at: string
          status: Database["public"]["Enums"]["shift_status"]
          status_changed_at: string
          timezone: string
          updated_at: string
        }
        Insert: {
          agency_facility_id: string
          agency_organisation_id: string
          agency_organisation_type?: Database["public"]["Enums"]["organisation_type"]
          cancellation_reason?:
            | Database["public"]["Enums"]["shift_cancellation_reason"]
            | null
          cancelled_at?: string | null
          cancelled_by_profile_id?: string | null
          completed_at?: string | null
          created_at?: string
          created_by_membership_id: string
          created_by_organisation_id: string
          created_by_profile_id?: string | null
          discipline_key: string
          end_at: string
          external_reference?: string | null
          facility_location_id: string
          id?: string
          instructions?: string | null
          opened_at?: string | null
          opened_by_profile_id?: string | null
          relationship_id: string
          requested_headcount: number
          source: Database["public"]["Enums"]["shift_source"]
          start_at: string
          status: Database["public"]["Enums"]["shift_status"]
          status_changed_at?: string
          timezone: string
          updated_at?: string
        }
        Update: {
          agency_facility_id?: string
          agency_organisation_id?: string
          agency_organisation_type?: Database["public"]["Enums"]["organisation_type"]
          cancellation_reason?:
            | Database["public"]["Enums"]["shift_cancellation_reason"]
            | null
          cancelled_at?: string | null
          cancelled_by_profile_id?: string | null
          completed_at?: string | null
          created_at?: string
          created_by_membership_id?: string
          created_by_organisation_id?: string
          created_by_profile_id?: string | null
          discipline_key?: string
          end_at?: string
          external_reference?: string | null
          facility_location_id?: string
          id?: string
          instructions?: string | null
          opened_at?: string | null
          opened_by_profile_id?: string | null
          relationship_id?: string
          requested_headcount?: number
          source?: Database["public"]["Enums"]["shift_source"]
          start_at?: string
          status?: Database["public"]["Enums"]["shift_status"]
          status_changed_at?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shifts_agency_facility_id_agency_organisation_id_fkey"
            columns: ["agency_facility_id", "agency_organisation_id"]
            isOneToOne: false
            referencedRelation: "agency_facilities"
            referencedColumns: ["id", "agency_organisation_id"]
          },
          {
            foreignKeyName: "shifts_agency_organisation_id_agency_organisation_type_fkey"
            columns: ["agency_organisation_id", "agency_organisation_type"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id", "type"]
          },
          {
            foreignKeyName: "shifts_cancelled_by_profile_id_fkey"
            columns: ["cancelled_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_created_by_membership_id_created_by_organisation_id_fkey"
            columns: ["created_by_membership_id", "created_by_organisation_id"]
            isOneToOne: false
            referencedRelation: "organisation_memberships"
            referencedColumns: ["id", "organisation_id"]
          },
          {
            foreignKeyName: "shifts_created_by_profile_id_fkey"
            columns: ["created_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_discipline_key_fkey"
            columns: ["discipline_key"]
            isOneToOne: false
            referencedRelation: "disciplines"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "shifts_facility_location_id_agency_facility_id_fkey"
            columns: ["facility_location_id", "agency_facility_id"]
            isOneToOne: false
            referencedRelation: "facility_locations"
            referencedColumns: ["id", "agency_facility_id"]
          },
          {
            foreignKeyName: "shifts_opened_by_profile_id_fkey"
            columns: ["opened_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_relationship_id_agency_organisation_id_agency_facil_fkey"
            columns: [
              "relationship_id",
              "agency_organisation_id",
              "agency_facility_id",
            ]
            isOneToOne: false
            referencedRelation: "agency_facility_relationships"
            referencedColumns: [
              "id",
              "agency_organisation_id",
              "agency_facility_id",
            ]
          },
        ]
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
      accept_shift_assignment: {
        Args: { p_assignment_id: string }
        Returns: undefined
      }
      accept_shift_offer: {
        Args: { p_offer_id: string }
        Returns: {
          assignment_id: string
          block_reasons: Database["public"]["Enums"]["assignment_block_reason"][]
          compliance_findings: Json
          compliance_reasons: Database["public"]["Enums"]["compliance_reason"][]
          outcome: Database["public"]["Enums"]["assignment_decision_outcome"]
          primary_reason: Database["public"]["Enums"]["assignment_block_reason"]
        }[]
      }
      add_agency_worker_note: {
        Args: { p_body: string; p_worker_id: string }
        Returns: string
      }
      add_shift_internal_note: {
        Args: { p_body: string; p_shift_id: string }
        Returns: string
      }
      assign_membership_role: {
        Args: { p_membership_id: string; p_role_key: string }
        Returns: string
      }
      assign_worker_to_shift: {
        Args: { p_agency_worker_id: string; p_shift_id: string }
        Returns: {
          assignment_id: string
          block_reasons: Database["public"]["Enums"]["assignment_block_reason"][]
          compliance_findings: Json
          compliance_reasons: Database["public"]["Enums"]["compliance_reason"][]
          decision_id: string
          outcome: Database["public"]["Enums"]["assignment_decision_outcome"]
          primary_reason: Database["public"]["Enums"]["assignment_block_reason"]
        }[]
      }
      authorize_credential_document_access: {
        Args: { p_document_id: string; p_organisation_id?: string }
        Returns: {
          object_path: string
        }[]
      }
      begin_credential_document_upload: {
        Args: {
          p_credential_version_id: string
          p_mime_type: string
          p_size_bytes: number
        }
        Returns: {
          document_id: string
          object_path: string
        }[]
      }
      cancel_shift: {
        Args: {
          p_reason: Database["public"]["Enums"]["shift_cancellation_reason"]
          p_shift_id: string
        }
        Returns: undefined
      }
      cancel_shift_assignment: {
        Args: {
          p_assignment_id: string
          p_reason: Database["public"]["Enums"]["assignment_cancellation_reason"]
        }
        Returns: undefined
      }
      cancel_shift_offer: { Args: { p_offer_id: string }; Returns: undefined }
      complete_credential_document_upload: {
        Args: {
          p_content_valid: boolean
          p_document_id: string
          p_sha256: string
        }
        Returns: Database["public"]["Enums"]["document_status"]
      }
      complete_shift: { Args: { p_shift_id: string }; Returns: undefined }
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
      create_credential: {
        Args: {
          p_credential_number?: string
          p_credential_type_key: string
          p_expiry_date?: string
          p_issue_date?: string
          p_issuing_authority?: string
          p_jurisdiction_code?: string
        }
        Returns: {
          credential_id: string
          credential_version_id: string
        }[]
      }
      create_credential_requirement: {
        Args: {
          p_agency_facility_id?: string
          p_agency_organisation_id: string
          p_credential_type_key: string
          p_discipline_key?: string
          p_expiry_warning_days?: number
          p_jurisdiction_code?: string
          p_minimum_validity_days?: number
          p_must_be_verified?: boolean
        }
        Returns: string
      }
      create_credential_version: {
        Args: {
          p_credential_id: string
          p_expiry_date?: string
          p_issue_date?: string
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
      create_shift: {
        Args: {
          p_agency_facility_id: string
          p_discipline_key: string
          p_end_time: string
          p_external_reference?: string
          p_facility_location_id: string
          p_instructions?: string
          p_open?: boolean
          p_requested_headcount: number
          p_shift_date: string
          p_start_time: string
        }
        Returns: string
      }
      decline_shift_assignment: {
        Args: { p_assignment_id: string }
        Returns: undefined
      }
      decline_shift_offer: { Args: { p_offer_id: string }; Returns: undefined }
      evaluate_worker_compliance: {
        Args: {
          p_agency_facility_id?: string
          p_agency_worker_id: string
          p_as_of?: string
        }
        Returns: {
          credential_id: string
          credential_type_key: string
          credential_type_name: string
          effective_expiry_date: string
          reason: Database["public"]["Enums"]["compliance_reason"]
          requirement_id: string
          requirement_scope: string
          severity: Database["public"]["Enums"]["compliance_severity"]
        }[]
      }
      list_agency_shifts: {
        Args: {
          p_agency_facility_id?: string
          p_from?: string
          p_organisation_id: string
          p_status?: Database["public"]["Enums"]["shift_status"]
          p_to?: string
        }
        Returns: {
          accepted_count: number
          active_count: number
          agency_facility_id: string
          discipline_key: string
          discipline_name: string
          end_at: string
          external_reference: string
          facility_name: string
          fill_state: string
          location_name: string
          relationship_status: Database["public"]["Enums"]["relationship_status"]
          requested_headcount: number
          shift_id: string
          source: Database["public"]["Enums"]["shift_source"]
          start_at: string
          status: Database["public"]["Enums"]["shift_status"]
          timezone: string
        }[]
      }
      list_agency_shifts_page: {
        Args: {
          p_after_id?: string
          p_after_start_at?: string
          p_agency_facility_id?: string
          p_from?: string
          p_limit?: number
          p_organisation_id: string
          p_status?: Database["public"]["Enums"]["shift_status"]
          p_to?: string
        }
        Returns: {
          accepted_count: number
          active_count: number
          agency_facility_id: string
          discipline_key: string
          discipline_name: string
          end_at: string
          external_reference: string
          facility_name: string
          fill_state: string
          location_name: string
          open_issue_count: number
          relationship_status: Database["public"]["Enums"]["relationship_status"]
          requested_headcount: number
          shift_id: string
          source: Database["public"]["Enums"]["shift_source"]
          start_at: string
          status: Database["public"]["Enums"]["shift_status"]
          timezone: string
        }[]
      }
      list_agency_worker_credentials: {
        Args: { p_agency_worker_id: string }
        Returns: {
          agency_verification: Database["public"]["Enums"]["verification_outcome"]
          credential_id: string
          credential_type_key: string
          credential_type_name: string
          documents_cleared: boolean
          effective_expiry_date: string
          jurisdiction_code: string
          latest_version_id: string
          latest_version_number: number
          latest_version_status: Database["public"]["Enums"]["credential_version_status"]
          shared_at: string
        }[]
      }
      list_assignment_issues: {
        Args: { p_organisation_id: string; p_shift_id?: string }
        Returns: {
          assignment_id: string
          assignment_status: Database["public"]["Enums"]["assignment_status"]
          block_reasons: Database["public"]["Enums"]["assignment_block_reason"][]
          compliance_reasons: Database["public"]["Enums"]["compliance_reason"][]
          detected_by: Database["public"]["Enums"]["assignment_issue_source"]
          end_at: string
          facility_name: string
          issue_id: string
          issue_type: Database["public"]["Enums"]["assignment_issue_type"]
          last_evaluated_at: string
          opened_at: string
          severity: Database["public"]["Enums"]["assignment_issue_severity"]
          shift_id: string
          start_at: string
          timezone: string
          worker_name: string
        }[]
      }
      list_assignment_readiness: {
        Args: {
          p_from?: string
          p_organisation_id: string
          p_shift_id?: string
          p_until?: string
        }
        Returns: {
          agency_worker_id: string
          assignment_id: string
          block_reasons: Database["public"]["Enums"]["assignment_block_reason"][]
          compliance_findings: Json
          compliance_reasons: Database["public"]["Enums"]["compliance_reason"][]
          display_name: string
          eligible: boolean
          end_at: string
          readiness: Database["public"]["Enums"]["readiness_status"]
          relationship_active: boolean
          shift_id: string
          start_at: string
          status: Database["public"]["Enums"]["assignment_status"]
          timezone: string
        }[]
      }
      list_facility_request_options: {
        Args: { p_relationship_id: string }
        Returns: {
          facility_location_id: string
          location_name: string
          timezone: string
        }[]
      }
      list_facility_shift_assignments: {
        Args: { p_shift_id: string }
        Returns: {
          assignment_id: string
          discipline_name: string
          readiness: Database["public"]["Enums"]["readiness_status"]
          status: Database["public"]["Enums"]["assignment_status"]
          worker_display_name: string
        }[]
      }
      list_facility_shifts: {
        Args: { p_facility_organisation_id: string; p_shift_id?: string }
        Returns: {
          accepted_count: number
          active_count: number
          agency_name: string
          cancellation_reason: Database["public"]["Enums"]["shift_cancellation_reason"]
          discipline_key: string
          discipline_name: string
          end_at: string
          external_reference: string
          fill_state: string
          instructions: string
          location_name: string
          relationship_id: string
          relationship_status: Database["public"]["Enums"]["relationship_status"]
          requested_headcount: number
          shift_id: string
          source: Database["public"]["Enums"]["shift_source"]
          start_at: string
          status: Database["public"]["Enums"]["shift_status"]
          timezone: string
        }[]
      }
      list_facility_shifts_page: {
        Args: {
          p_before_id?: string
          p_before_start_at?: string
          p_facility_organisation_id: string
          p_limit?: number
        }
        Returns: {
          accepted_count: number
          active_count: number
          agency_name: string
          cancellation_reason: Database["public"]["Enums"]["shift_cancellation_reason"]
          discipline_key: string
          discipline_name: string
          end_at: string
          external_reference: string
          fill_state: string
          instructions: string
          location_name: string
          relationship_id: string
          relationship_status: Database["public"]["Enums"]["relationship_status"]
          requested_headcount: number
          shift_id: string
          source: Database["public"]["Enums"]["shift_source"]
          start_at: string
          status: Database["public"]["Enums"]["shift_status"]
          timezone: string
        }[]
      }
      list_my_shift_assignments: {
        Args: { p_organisation_id: string }
        Returns: {
          accepted_at: string
          assigned_at: string
          assignment_id: string
          can_respond: boolean
          cancellation_reason: Database["public"]["Enums"]["assignment_cancellation_reason"]
          discipline_name: string
          end_at: string
          facility_name: string
          instructions: string
          location_name: string
          shift_id: string
          shift_status: Database["public"]["Enums"]["shift_status"]
          start_at: string
          status: Database["public"]["Enums"]["assignment_status"]
          timezone: string
        }[]
      }
      list_my_shift_offers: {
        Args: { p_organisation_id: string }
        Returns: {
          can_respond: boolean
          discipline_name: string
          end_at: string
          expires_at: string
          facility_name: string
          location_name: string
          offer_id: string
          start_at: string
          status: Database["public"]["Enums"]["shift_offer_status"]
          timezone: string
        }[]
      }
      list_notification_deliveries: {
        Args: {
          p_limit?: number
          p_organisation_id: string
          p_problems_only?: boolean
        }
        Returns: {
          attempts: number
          created_at: string
          event: string
          last_error_code: string
          next_attempt_at: string
          notification_id: string
          recipient_name: string
          sent_at: string
          shift_id: string
          state: string
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
      list_relationship_affected_shifts: {
        Args: { p_organisation_id: string }
        Returns: {
          active_count: number
          end_at: string
          facility_name: string
          relationship_status: Database["public"]["Enums"]["relationship_status"]
          shift_id: string
          start_at: string
          status: Database["public"]["Enums"]["shift_status"]
          timezone: string
        }[]
      }
      list_shared_worker_compliance: {
        Args: { p_relationship_id: string }
        Returns: {
          agency_worker_id: string
          credential_type_name: string
          effective_expiry_date: string
          readiness: Database["public"]["Enums"]["readiness_status"]
          reason: Database["public"]["Enums"]["compliance_reason"]
          severity: Database["public"]["Enums"]["compliance_severity"]
          worker_display_name: string
        }[]
      }
      list_shift_candidates: {
        Args: { p_shift_id: string }
        Returns: {
          agency_worker_id: string
          assignable: boolean
          block_reasons: Database["public"]["Enums"]["assignment_block_reason"][]
          compliance_findings: Json
          compliance_reasons: Database["public"]["Enums"]["compliance_reason"][]
          display_name: string
          primary_reason: Database["public"]["Enums"]["assignment_block_reason"]
          readiness: Database["public"]["Enums"]["readiness_status"]
          worker_status: Database["public"]["Enums"]["worker_status"]
        }[]
      }
      list_shift_candidates_page: {
        Args: {
          p_after_id?: string
          p_after_name?: string
          p_include_unavailable?: boolean
          p_limit?: number
          p_shift_id: string
        }
        Returns: {
          agency_worker_id: string
          assignable: boolean
          block_reasons: Database["public"]["Enums"]["assignment_block_reason"][]
          compliance_findings: Json
          compliance_reasons: Database["public"]["Enums"]["compliance_reason"][]
          display_name: string
          has_live_offer: boolean
          primary_reason: Database["public"]["Enums"]["assignment_block_reason"]
          readiness: Database["public"]["Enums"]["readiness_status"]
          worker_status: Database["public"]["Enums"]["worker_status"]
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
      offer_shift_to_workers: {
        Args: {
          p_agency_worker_ids: string[]
          p_expires_in_minutes?: number
          p_shift_id: string
        }
        Returns: {
          agency_worker_id: string
          offer_id: string
          outcome: string
          reason: string
        }[]
      }
      open_shift: { Args: { p_shift_id: string }; Returns: undefined }
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
      recheck_shift_readiness: {
        Args: { p_shift_id: string }
        Returns: {
          checked: number
          opened: number
          resolved: number
        }[]
      }
      record_credential_verification: {
        Args: {
          p_agency_facility_id?: string
          p_agency_organisation_id: string
          p_credential_version_id: string
          p_outcome: Database["public"]["Enums"]["verification_outcome"]
          p_rejection_reason?: Database["public"]["Enums"]["verification_rejection_reason"]
        }
        Returns: string
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
      revoke_credential_share: {
        Args: { p_share_id: string }
        Returns: undefined
      }
      revoke_membership_role: {
        Args: { p_membership_id: string; p_role_key: string }
        Returns: undefined
      }
      revoke_organisation_invite: {
        Args: { p_invite_id: string }
        Returns: undefined
      }
      revoke_worker_compliance_share: {
        Args: { p_share_id: string }
        Returns: undefined
      }
      set_agency_facility_status: {
        Args: {
          p_facility_id: string
          p_status: Database["public"]["Enums"]["facility_status"]
        }
        Returns: undefined
      }
      set_agency_worker_discipline: {
        Args: {
          p_agency_worker_id: string
          p_assigned: boolean
          p_discipline_key: string
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
      share_credential: {
        Args: { p_agency_organisation_id: string; p_credential_id: string }
        Returns: string
      }
      share_worker_compliance: {
        Args: { p_agency_worker_id: string; p_relationship_id: string }
        Returns: string
      }
      submit_credential_version: {
        Args: { p_credential_version_id: string }
        Returns: undefined
      }
      submit_facility_shift_request: {
        Args: {
          p_discipline_key: string
          p_end_time: string
          p_external_reference?: string
          p_facility_location_id: string
          p_instructions?: string
          p_relationship_id: string
          p_requested_headcount: number
          p_shift_date: string
          p_start_time: string
        }
        Returns: string
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
      update_credential_requirement: {
        Args: {
          p_expiry_warning_days: number
          p_minimum_validity_days: number
          p_must_be_verified: boolean
          p_requirement_id: string
          p_status: Database["public"]["Enums"]["requirement_status"]
        }
        Returns: undefined
      }
      update_shift: {
        Args: {
          p_discipline_key: string
          p_end_time: string
          p_external_reference: string
          p_facility_location_id: string
          p_instructions: string
          p_requested_headcount: number
          p_shift_date: string
          p_shift_id: string
          p_start_time: string
        }
        Returns: undefined
      }
      withdraw_credential: {
        Args: { p_credential_id: string }
        Returns: undefined
      }
      withdraw_credential_version: {
        Args: { p_credential_version_id: string }
        Returns: undefined
      }
      worker_readiness: {
        Args: {
          p_agency_facility_id?: string
          p_agency_worker_id: string
          p_as_of?: string
        }
        Returns: {
          blocking_count: number
          readiness: Database["public"]["Enums"]["readiness_status"]
          warning_count: number
        }[]
      }
    }
    Enums: {
      assignment_block_reason:
        | "ASSIGNMENT_ALREADY_EXISTS"
        | "SHIFT_FULL"
        | "WORKER_NOT_ACTIVE"
        | "DISCIPLINE_MISMATCH"
        | "WORKER_NOT_ELIGIBLE"
        | "WORKER_SCHEDULE_CONFLICT"
      assignment_cancellation_reason:
        | "shift_cancelled"
        | "worker_unavailable"
        | "compliance_change"
        | "entered_in_error"
        | "relationship_suspended"
        | "other"
      assignment_decision_outcome: "allowed" | "refused"
      assignment_issue_resolution:
        | "eligible_again"
        | "relationship_restored"
        | "assignment_closed"
        | "shift_closed"
      assignment_issue_severity: "attention" | "urgent"
      assignment_issue_source:
        | "scheduled_scan"
        | "manual_recheck"
        | "relationship_change"
      assignment_issue_status: "open" | "resolved"
      assignment_issue_type: "not_eligible" | "relationship_not_active"
      assignment_status: "assigned" | "accepted" | "declined" | "cancelled"
      compliance_reason:
        | "MET"
        | "EXPIRING_SOON"
        | "MISSING_CREDENTIAL"
        | "CREDENTIAL_NOT_SHARED"
        | "WRONG_JURISDICTION"
        | "NOT_SUBMITTED"
        | "DOCUMENT_MISSING"
        | "DOCUMENT_NOT_CLEARED"
        | "UNVERIFIED_CREDENTIAL"
        | "VERIFICATION_REJECTED"
        | "EXPIRED_CREDENTIAL"
        | "INSUFFICIENT_VALIDITY"
        | "WORKER_NOT_ACTIVE"
        | "DISCIPLINE_NOT_SET"
      compliance_severity: "ok" | "warning" | "blocking"
      compliance_share_status: "active" | "revoked"
      credential_category:
        | "professional_license"
        | "certification"
        | "background_screening"
        | "health_screening"
        | "training"
        | "identity_work_authorization"
        | "competency"
      credential_jurisdiction_rule: "none" | "country" | "subdivision"
      credential_scope: "person" | "facility"
      credential_share_status: "active" | "revoked"
      credential_status: "active" | "withdrawn"
      credential_version_status: "draft" | "submitted" | "withdrawn"
      document_status:
        | "upload_pending"
        | "scanning"
        | "clean"
        | "rejected"
        | "quarantined"
      facility_location_status: "active" | "inactive"
      facility_status: "active" | "inactive" | "archived"
      invite_delivery_status: "not_attempted" | "sent" | "failed" | "skipped"
      invite_status: "pending" | "accepted" | "revoked"
      jurisdiction_level: "country" | "subdivision"
      membership_status: "active" | "suspended" | "revoked"
      organisation_status: "active" | "suspended" | "archived"
      organisation_type: "agency" | "facility"
      profile_status: "active" | "suspended"
      readiness_status: "ready" | "action_required" | "not_eligible"
      relationship_status: "pending" | "active" | "suspended" | "ended"
      requirement_status: "active" | "inactive"
      shift_cancellation_reason:
        | "facility_cancelled"
        | "staffing_no_longer_needed"
        | "entered_in_error"
        | "relationship_suspended"
        | "other"
        | "relationship_ended"
      shift_offer_close_reason:
        | "shift_filled"
        | "shift_cancelled"
        | "shift_closed"
        | "withdrawn"
        | "relationship_not_active"
        | "assigned_directly"
      shift_offer_status:
        | "offered"
        | "accepted"
        | "declined"
        | "expired"
        | "cancelled"
      shift_source: "agency" | "facility"
      shift_status: "draft" | "submitted" | "open" | "cancelled" | "completed"
      verification_outcome: "under_review" | "verified" | "rejected"
      verification_rejection_reason:
        | "document_illegible"
        | "details_mismatch"
        | "expired"
        | "wrong_credential_type"
        | "not_authentic"
        | "incomplete"
        | "other"
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
      assignment_block_reason: [
        "ASSIGNMENT_ALREADY_EXISTS",
        "SHIFT_FULL",
        "WORKER_NOT_ACTIVE",
        "DISCIPLINE_MISMATCH",
        "WORKER_NOT_ELIGIBLE",
        "WORKER_SCHEDULE_CONFLICT",
      ],
      assignment_cancellation_reason: [
        "shift_cancelled",
        "worker_unavailable",
        "compliance_change",
        "entered_in_error",
        "relationship_suspended",
        "other",
      ],
      assignment_decision_outcome: ["allowed", "refused"],
      assignment_issue_resolution: [
        "eligible_again",
        "relationship_restored",
        "assignment_closed",
        "shift_closed",
      ],
      assignment_issue_severity: ["attention", "urgent"],
      assignment_issue_source: [
        "scheduled_scan",
        "manual_recheck",
        "relationship_change",
      ],
      assignment_issue_status: ["open", "resolved"],
      assignment_issue_type: ["not_eligible", "relationship_not_active"],
      assignment_status: ["assigned", "accepted", "declined", "cancelled"],
      compliance_reason: [
        "MET",
        "EXPIRING_SOON",
        "MISSING_CREDENTIAL",
        "CREDENTIAL_NOT_SHARED",
        "WRONG_JURISDICTION",
        "NOT_SUBMITTED",
        "DOCUMENT_MISSING",
        "DOCUMENT_NOT_CLEARED",
        "UNVERIFIED_CREDENTIAL",
        "VERIFICATION_REJECTED",
        "EXPIRED_CREDENTIAL",
        "INSUFFICIENT_VALIDITY",
        "WORKER_NOT_ACTIVE",
        "DISCIPLINE_NOT_SET",
      ],
      compliance_severity: ["ok", "warning", "blocking"],
      compliance_share_status: ["active", "revoked"],
      credential_category: [
        "professional_license",
        "certification",
        "background_screening",
        "health_screening",
        "training",
        "identity_work_authorization",
        "competency",
      ],
      credential_jurisdiction_rule: ["none", "country", "subdivision"],
      credential_scope: ["person", "facility"],
      credential_share_status: ["active", "revoked"],
      credential_status: ["active", "withdrawn"],
      credential_version_status: ["draft", "submitted", "withdrawn"],
      document_status: [
        "upload_pending",
        "scanning",
        "clean",
        "rejected",
        "quarantined",
      ],
      facility_location_status: ["active", "inactive"],
      facility_status: ["active", "inactive", "archived"],
      invite_delivery_status: ["not_attempted", "sent", "failed", "skipped"],
      invite_status: ["pending", "accepted", "revoked"],
      jurisdiction_level: ["country", "subdivision"],
      membership_status: ["active", "suspended", "revoked"],
      organisation_status: ["active", "suspended", "archived"],
      organisation_type: ["agency", "facility"],
      profile_status: ["active", "suspended"],
      readiness_status: ["ready", "action_required", "not_eligible"],
      relationship_status: ["pending", "active", "suspended", "ended"],
      requirement_status: ["active", "inactive"],
      shift_cancellation_reason: [
        "facility_cancelled",
        "staffing_no_longer_needed",
        "entered_in_error",
        "relationship_suspended",
        "other",
        "relationship_ended",
      ],
      shift_offer_close_reason: [
        "shift_filled",
        "shift_cancelled",
        "shift_closed",
        "withdrawn",
        "relationship_not_active",
        "assigned_directly",
      ],
      shift_offer_status: [
        "offered",
        "accepted",
        "declined",
        "expired",
        "cancelled",
      ],
      shift_source: ["agency", "facility"],
      shift_status: ["draft", "submitted", "open", "cancelled", "completed"],
      verification_outcome: ["under_review", "verified", "rejected"],
      verification_rejection_reason: [
        "document_illegible",
        "details_mismatch",
        "expired",
        "wrong_credential_type",
        "not_authentic",
        "incomplete",
        "other",
      ],
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
