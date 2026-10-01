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
      agency_attendance_settings: {
        Row: {
          agency_organisation_id: string
          agency_organisation_type: Database["public"]["Enums"]["organisation_type"]
          clock_out_cutoff_minutes: number
          early_clock_in_minutes: number
          early_clock_out_minutes: number
          late_clock_in_minutes: number
          late_clock_out_minutes: number
          location_evidence_retention_days: number
          missed_clock_in_minutes: number
          missed_clock_out_minutes: number
          updated_at: string
          updated_by_profile_id: string | null
        }
        Insert: {
          agency_organisation_id: string
          agency_organisation_type?: Database["public"]["Enums"]["organisation_type"]
          clock_out_cutoff_minutes?: number
          early_clock_in_minutes?: number
          early_clock_out_minutes?: number
          late_clock_in_minutes?: number
          late_clock_out_minutes?: number
          location_evidence_retention_days?: number
          missed_clock_in_minutes?: number
          missed_clock_out_minutes?: number
          updated_at?: string
          updated_by_profile_id?: string | null
        }
        Update: {
          agency_organisation_id?: string
          agency_organisation_type?: Database["public"]["Enums"]["organisation_type"]
          clock_out_cutoff_minutes?: number
          early_clock_in_minutes?: number
          early_clock_out_minutes?: number
          late_clock_in_minutes?: number
          late_clock_out_minutes?: number
          location_evidence_retention_days?: number
          missed_clock_in_minutes?: number
          missed_clock_out_minutes?: number
          updated_at?: string
          updated_by_profile_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agency_attendance_settings_agency_organisation_id_agency_o_fkey"
            columns: ["agency_organisation_id", "agency_organisation_type"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id", "type"]
          },
          {
            foreignKeyName: "agency_attendance_settings_updated_by_profile_id_fkey"
            columns: ["updated_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
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
      agency_financial_settings: {
        Row: {
          agency_organisation_id: string
          invoice_reference_prefix: string
          payroll_anchor_date: string
          payroll_period_type: Database["public"]["Enums"]["payroll_period_type"]
          payroll_reference_prefix: string
          payroll_week_starts_on: number
          updated_at: string
          updated_by_profile_id: string | null
        }
        Insert: {
          agency_organisation_id: string
          invoice_reference_prefix?: string
          payroll_anchor_date: string
          payroll_period_type?: Database["public"]["Enums"]["payroll_period_type"]
          payroll_reference_prefix?: string
          payroll_week_starts_on: number
          updated_at?: string
          updated_by_profile_id?: string | null
        }
        Update: {
          agency_organisation_id?: string
          invoice_reference_prefix?: string
          payroll_anchor_date?: string
          payroll_period_type?: Database["public"]["Enums"]["payroll_period_type"]
          payroll_reference_prefix?: string
          payroll_week_starts_on?: number
          updated_at?: string
          updated_by_profile_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agency_financial_settings_agency_organisation_id_fkey"
            columns: ["agency_organisation_id"]
            isOneToOne: true
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agency_financial_settings_updated_by_profile_id_fkey"
            columns: ["updated_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      agency_timesheet_settings: {
        Row: {
          agency_organisation_id: string
          agency_organisation_type: Database["public"]["Enums"]["organisation_type"]
          created_at: string
          updated_at: string
          updated_by_profile_id: string | null
          week_starts_on: number
        }
        Insert: {
          agency_organisation_id: string
          agency_organisation_type?: Database["public"]["Enums"]["organisation_type"]
          created_at?: string
          updated_at?: string
          updated_by_profile_id?: string | null
          week_starts_on?: number
        }
        Update: {
          agency_organisation_id?: string
          agency_organisation_type?: Database["public"]["Enums"]["organisation_type"]
          created_at?: string
          updated_at?: string
          updated_by_profile_id?: string | null
          week_starts_on?: number
        }
        Relationships: [
          {
            foreignKeyName: "agency_timesheet_settings_agency_organisation_id_agency_or_fkey"
            columns: ["agency_organisation_id", "agency_organisation_type"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id", "type"]
          },
          {
            foreignKeyName: "agency_timesheet_settings_updated_by_profile_id_fkey"
            columns: ["updated_by_profile_id"]
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
      assignment_attendance: {
        Row: {
          agency_facility_id: string
          agency_organisation_id: string
          agency_worker_id: string
          assignment_id: string
          clock_in_at: string | null
          clock_out_at: string | null
          clock_state: Database["public"]["Enums"]["attendance_clock_state"]
          created_at: string
          facility_location_id: string
          id: string
          open_exception_count: number
          profile_id: string
          shift_id: string
          updated_at: string
        }
        Insert: {
          agency_facility_id: string
          agency_organisation_id: string
          agency_worker_id: string
          assignment_id: string
          clock_in_at?: string | null
          clock_out_at?: string | null
          clock_state?: Database["public"]["Enums"]["attendance_clock_state"]
          created_at?: string
          facility_location_id: string
          id?: string
          open_exception_count?: number
          profile_id: string
          shift_id: string
          updated_at?: string
        }
        Update: {
          agency_facility_id?: string
          agency_organisation_id?: string
          agency_worker_id?: string
          assignment_id?: string
          clock_in_at?: string | null
          clock_out_at?: string | null
          clock_state?: Database["public"]["Enums"]["attendance_clock_state"]
          created_at?: string
          facility_location_id?: string
          id?: string
          open_exception_count?: number
          profile_id?: string
          shift_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "assignment_attendance_assignment_id_agency_organisation_id_fkey"
            columns: [
              "assignment_id",
              "agency_organisation_id",
              "shift_id",
              "agency_worker_id",
              "profile_id",
            ]
            isOneToOne: false
            referencedRelation: "shift_assignments"
            referencedColumns: [
              "id",
              "agency_organisation_id",
              "shift_id",
              "agency_worker_id",
              "profile_id",
            ]
          },
          {
            foreignKeyName: "assignment_attendance_shift_id_agency_organisation_id_agen_fkey"
            columns: [
              "shift_id",
              "agency_organisation_id",
              "agency_facility_id",
              "facility_location_id",
            ]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: [
              "id",
              "agency_organisation_id",
              "agency_facility_id",
              "facility_location_id",
            ]
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
      attendance_corrections: {
        Row: {
          adjustment_reason:
            | Database["public"]["Enums"]["attendance_adjustment_reason"]
            | null
          agency_organisation_id: string
          approved_time: string | null
          assignment_id: string
          attendance_id: string
          id: string
          origin: Database["public"]["Enums"]["attendance_correction_origin"]
          reason: Database["public"]["Enums"]["attendance_correction_reason"]
          requested_at: string
          requested_by_profile_id: string
          requested_event_type: Database["public"]["Enums"]["attendance_event_type"]
          requested_time: string
          resolution:
            | Database["public"]["Enums"]["attendance_correction_resolution"]
            | null
          reviewed_at: string | null
          reviewed_by_membership_id: string | null
          reviewer_note: string | null
          segment: number
          status: Database["public"]["Enums"]["attendance_correction_status"]
          worker_note: string | null
        }
        Insert: {
          adjustment_reason?:
            | Database["public"]["Enums"]["attendance_adjustment_reason"]
            | null
          agency_organisation_id: string
          approved_time?: string | null
          assignment_id: string
          attendance_id: string
          id?: string
          origin?: Database["public"]["Enums"]["attendance_correction_origin"]
          reason: Database["public"]["Enums"]["attendance_correction_reason"]
          requested_at?: string
          requested_by_profile_id: string
          requested_event_type: Database["public"]["Enums"]["attendance_event_type"]
          requested_time: string
          resolution?:
            | Database["public"]["Enums"]["attendance_correction_resolution"]
            | null
          reviewed_at?: string | null
          reviewed_by_membership_id?: string | null
          reviewer_note?: string | null
          segment?: number
          status?: Database["public"]["Enums"]["attendance_correction_status"]
          worker_note?: string | null
        }
        Update: {
          adjustment_reason?:
            | Database["public"]["Enums"]["attendance_adjustment_reason"]
            | null
          agency_organisation_id?: string
          approved_time?: string | null
          assignment_id?: string
          attendance_id?: string
          id?: string
          origin?: Database["public"]["Enums"]["attendance_correction_origin"]
          reason?: Database["public"]["Enums"]["attendance_correction_reason"]
          requested_at?: string
          requested_by_profile_id?: string
          requested_event_type?: Database["public"]["Enums"]["attendance_event_type"]
          requested_time?: string
          resolution?:
            | Database["public"]["Enums"]["attendance_correction_resolution"]
            | null
          reviewed_at?: string | null
          reviewed_by_membership_id?: string | null
          reviewer_note?: string | null
          segment?: number
          status?: Database["public"]["Enums"]["attendance_correction_status"]
          worker_note?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "attendance_corrections_attendance_id_agency_organisation_i_fkey"
            columns: ["attendance_id", "agency_organisation_id"]
            isOneToOne: false
            referencedRelation: "assignment_attendance"
            referencedColumns: ["id", "agency_organisation_id"]
          },
          {
            foreignKeyName: "attendance_corrections_attendance_id_assignment_id_fkey"
            columns: ["attendance_id", "assignment_id"]
            isOneToOne: false
            referencedRelation: "assignment_attendance"
            referencedColumns: ["id", "assignment_id"]
          },
          {
            foreignKeyName: "attendance_corrections_requested_by_profile_id_fkey"
            columns: ["requested_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_corrections_reviewed_by_membership_id_agency_or_fkey"
            columns: ["reviewed_by_membership_id", "agency_organisation_id"]
            isOneToOne: false
            referencedRelation: "organisation_memberships"
            referencedColumns: ["id", "organisation_id"]
          },
        ]
      }
      attendance_events: {
        Row: {
          actor_profile_id: string | null
          agency_organisation_id: string
          assignment_id: string
          attendance_id: string
          correction_id: string | null
          event_type: Database["public"]["Enums"]["attendance_event_type"]
          geofence_result: Database["public"]["Enums"]["geofence_result"]
          id: string
          occurred_at: string
          recorded_at: string
          segment: number
          sequence: number
          source: Database["public"]["Enums"]["attendance_event_source"]
        }
        Insert: {
          actor_profile_id?: string | null
          agency_organisation_id: string
          assignment_id: string
          attendance_id: string
          correction_id?: string | null
          event_type: Database["public"]["Enums"]["attendance_event_type"]
          geofence_result?: Database["public"]["Enums"]["geofence_result"]
          id?: string
          occurred_at: string
          recorded_at?: string
          segment?: number
          sequence?: never
          source: Database["public"]["Enums"]["attendance_event_source"]
        }
        Update: {
          actor_profile_id?: string | null
          agency_organisation_id?: string
          assignment_id?: string
          attendance_id?: string
          correction_id?: string | null
          event_type?: Database["public"]["Enums"]["attendance_event_type"]
          geofence_result?: Database["public"]["Enums"]["geofence_result"]
          id?: string
          occurred_at?: string
          recorded_at?: string
          segment?: number
          sequence?: never
          source?: Database["public"]["Enums"]["attendance_event_source"]
        }
        Relationships: [
          {
            foreignKeyName: "attendance_events_actor_profile_id_fkey"
            columns: ["actor_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_events_attendance_id_agency_organisation_id_fkey"
            columns: ["attendance_id", "agency_organisation_id"]
            isOneToOne: false
            referencedRelation: "assignment_attendance"
            referencedColumns: ["id", "agency_organisation_id"]
          },
          {
            foreignKeyName: "attendance_events_attendance_id_assignment_id_fkey"
            columns: ["attendance_id", "assignment_id"]
            isOneToOne: false
            referencedRelation: "assignment_attendance"
            referencedColumns: ["id", "assignment_id"]
          },
          {
            foreignKeyName: "attendance_events_correction_fk"
            columns: ["correction_id", "attendance_id"]
            isOneToOne: false
            referencedRelation: "attendance_corrections"
            referencedColumns: ["id", "attendance_id"]
          },
        ]
      }
      attendance_evidence_legal_holds: {
        Row: {
          agency_organisation_id: string
          attendance_id: string
          id: string
          placed_at: string
          placed_by_membership_id: string
          reason: string
          released_at: string | null
          released_by_membership_id: string | null
        }
        Insert: {
          agency_organisation_id: string
          attendance_id: string
          id?: string
          placed_at?: string
          placed_by_membership_id: string
          reason: string
          released_at?: string | null
          released_by_membership_id?: string | null
        }
        Update: {
          agency_organisation_id?: string
          attendance_id?: string
          id?: string
          placed_at?: string
          placed_by_membership_id?: string
          reason?: string
          released_at?: string | null
          released_by_membership_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "attendance_evidence_legal_hol_attendance_id_agency_organis_fkey"
            columns: ["attendance_id", "agency_organisation_id"]
            isOneToOne: false
            referencedRelation: "assignment_attendance"
            referencedColumns: ["id", "agency_organisation_id"]
          },
          {
            foreignKeyName: "attendance_evidence_legal_hol_placed_by_membership_id_agen_fkey"
            columns: ["placed_by_membership_id", "agency_organisation_id"]
            isOneToOne: false
            referencedRelation: "organisation_memberships"
            referencedColumns: ["id", "organisation_id"]
          },
          {
            foreignKeyName: "attendance_evidence_legal_hol_released_by_membership_id_ag_fkey"
            columns: ["released_by_membership_id", "agency_organisation_id"]
            isOneToOne: false
            referencedRelation: "organisation_memberships"
            referencedColumns: ["id", "organisation_id"]
          },
        ]
      }
      attendance_exceptions: {
        Row: {
          agency_organisation_id: string
          assignment_id: string
          attendance_id: string
          detected_by: Database["public"]["Enums"]["attendance_exception_source"]
          exception_type: Database["public"]["Enums"]["attendance_exception_type"]
          id: string
          opened_at: string
          resolution:
            | Database["public"]["Enums"]["attendance_exception_resolution"]
            | null
          resolved_at: string | null
          reviewer_membership_id: string | null
          severity: Database["public"]["Enums"]["assignment_issue_severity"]
          status: Database["public"]["Enums"]["attendance_exception_status"]
        }
        Insert: {
          agency_organisation_id: string
          assignment_id: string
          attendance_id: string
          detected_by: Database["public"]["Enums"]["attendance_exception_source"]
          exception_type: Database["public"]["Enums"]["attendance_exception_type"]
          id?: string
          opened_at?: string
          resolution?:
            | Database["public"]["Enums"]["attendance_exception_resolution"]
            | null
          resolved_at?: string | null
          reviewer_membership_id?: string | null
          severity: Database["public"]["Enums"]["assignment_issue_severity"]
          status?: Database["public"]["Enums"]["attendance_exception_status"]
        }
        Update: {
          agency_organisation_id?: string
          assignment_id?: string
          attendance_id?: string
          detected_by?: Database["public"]["Enums"]["attendance_exception_source"]
          exception_type?: Database["public"]["Enums"]["attendance_exception_type"]
          id?: string
          opened_at?: string
          resolution?:
            | Database["public"]["Enums"]["attendance_exception_resolution"]
            | null
          resolved_at?: string | null
          reviewer_membership_id?: string | null
          severity?: Database["public"]["Enums"]["assignment_issue_severity"]
          status?: Database["public"]["Enums"]["attendance_exception_status"]
        }
        Relationships: [
          {
            foreignKeyName: "attendance_exceptions_attendance_id_agency_organisation_id_fkey"
            columns: ["attendance_id", "agency_organisation_id"]
            isOneToOne: false
            referencedRelation: "assignment_attendance"
            referencedColumns: ["id", "agency_organisation_id"]
          },
          {
            foreignKeyName: "attendance_exceptions_attendance_id_assignment_id_fkey"
            columns: ["attendance_id", "assignment_id"]
            isOneToOne: false
            referencedRelation: "assignment_attendance"
            referencedColumns: ["id", "assignment_id"]
          },
          {
            foreignKeyName: "attendance_exceptions_reviewer_membership_id_agency_organi_fkey"
            columns: ["reviewer_membership_id", "agency_organisation_id"]
            isOneToOne: false
            referencedRelation: "organisation_memberships"
            referencedColumns: ["id", "organisation_id"]
          },
        ]
      }
      attendance_location_evidence: {
        Row: {
          accuracy_meters: number | null
          agency_organisation_id: string
          attendance_id: string
          device_captured_at: string | null
          distance_meters: number | null
          event_id: string
          id: string
          latitude: number | null
          longitude: number | null
          purged_at: string | null
          radius_meters: number
          recorded_at: string
          result: Database["public"]["Enums"]["geofence_result"]
        }
        Insert: {
          accuracy_meters?: number | null
          agency_organisation_id: string
          attendance_id: string
          device_captured_at?: string | null
          distance_meters?: number | null
          event_id: string
          id?: string
          latitude?: number | null
          longitude?: number | null
          purged_at?: string | null
          radius_meters: number
          recorded_at?: string
          result: Database["public"]["Enums"]["geofence_result"]
        }
        Update: {
          accuracy_meters?: number | null
          agency_organisation_id?: string
          attendance_id?: string
          device_captured_at?: string | null
          distance_meters?: number | null
          event_id?: string
          id?: string
          latitude?: number | null
          longitude?: number | null
          purged_at?: string | null
          radius_meters?: number
          recorded_at?: string
          result?: Database["public"]["Enums"]["geofence_result"]
        }
        Relationships: [
          {
            foreignKeyName: "attendance_location_evidence_attendance_id_agency_organisa_fkey"
            columns: ["attendance_id", "agency_organisation_id"]
            isOneToOne: false
            referencedRelation: "assignment_attendance"
            referencedColumns: ["id", "agency_organisation_id"]
          },
          {
            foreignKeyName: "attendance_location_evidence_event_id_attendance_id_fkey"
            columns: ["event_id", "attendance_id"]
            isOneToOne: false
            referencedRelation: "attendance_events"
            referencedColumns: ["id", "attendance_id"]
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
          effective_from: string
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
      currencies: {
        Row: {
          active: boolean
          code: string
          minor_unit_digits: number
          name: string
        }
        Insert: {
          active?: boolean
          code: string
          minor_unit_digits: number
          name: string
        }
        Update: {
          active?: boolean
          code?: string
          minor_unit_digits?: number
          name?: string
        }
        Relationships: []
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
      financial_exports: {
        Row: {
          agency_organisation_id: string
          byte_size: number
          content_type: string
          currency: string
          export_number: number
          export_version: number
          file_name: string
          file_ref: string | null
          format: string
          generated_at: string
          generated_by_membership_id: string
          id: string
          invoice_draft_id: string | null
          payroll_batch_id: string | null
          period_end: string
          period_start: string
          row_count: number
          sha256: string
          source_reference: string
          source_status: string
          source_type: string
          total_minor: number
        }
        Insert: {
          agency_organisation_id: string
          byte_size: number
          content_type: string
          currency: string
          export_number: number
          export_version: number
          file_name: string
          file_ref?: string | null
          format: string
          generated_at?: string
          generated_by_membership_id: string
          id?: string
          invoice_draft_id?: string | null
          payroll_batch_id?: string | null
          period_end: string
          period_start: string
          row_count: number
          sha256: string
          source_reference: string
          source_status: string
          source_type: string
          total_minor: number
        }
        Update: {
          agency_organisation_id?: string
          byte_size?: number
          content_type?: string
          currency?: string
          export_number?: number
          export_version?: number
          file_name?: string
          file_ref?: string | null
          format?: string
          generated_at?: string
          generated_by_membership_id?: string
          id?: string
          invoice_draft_id?: string | null
          payroll_batch_id?: string | null
          period_end?: string
          period_start?: string
          row_count?: number
          sha256?: string
          source_reference?: string
          source_status?: string
          source_type?: string
          total_minor?: number
        }
        Relationships: [
          {
            foreignKeyName: "financial_exports_generated_by_membership_id_agency_organi_fkey"
            columns: ["generated_by_membership_id", "agency_organisation_id"]
            isOneToOne: false
            referencedRelation: "organisation_memberships"
            referencedColumns: ["id", "organisation_id"]
          },
          {
            foreignKeyName: "financial_exports_invoice_draft_id_agency_organisation_id__fkey"
            columns: [
              "invoice_draft_id",
              "agency_organisation_id",
              "period_start",
              "period_end",
              "currency",
            ]
            isOneToOne: false
            referencedRelation: "invoice_drafts"
            referencedColumns: [
              "id",
              "agency_organisation_id",
              "period_start",
              "period_end",
              "currency",
            ]
          },
          {
            foreignKeyName: "financial_exports_payroll_batch_id_agency_organisation_id__fkey"
            columns: [
              "payroll_batch_id",
              "agency_organisation_id",
              "period_start",
              "period_end",
              "currency",
            ]
            isOneToOne: false
            referencedRelation: "payroll_batches"
            referencedColumns: [
              "id",
              "agency_organisation_id",
              "period_start",
              "period_end",
              "currency",
            ]
          },
        ]
      }
      invoice_draft_history: {
        Row: {
          action: string
          actor_membership_id: string
          agency_organisation_id: string
          from_status:
            | Database["public"]["Enums"]["invoice_draft_status"]
            | null
          id: string
          invoice_draft_id: string
          note: string | null
          occurred_at: string
          to_status: Database["public"]["Enums"]["invoice_draft_status"]
        }
        Insert: {
          action: string
          actor_membership_id: string
          agency_organisation_id: string
          from_status?:
            | Database["public"]["Enums"]["invoice_draft_status"]
            | null
          id?: string
          invoice_draft_id: string
          note?: string | null
          occurred_at?: string
          to_status: Database["public"]["Enums"]["invoice_draft_status"]
        }
        Update: {
          action?: string
          actor_membership_id?: string
          agency_organisation_id?: string
          from_status?:
            | Database["public"]["Enums"]["invoice_draft_status"]
            | null
          id?: string
          invoice_draft_id?: string
          note?: string | null
          occurred_at?: string
          to_status?: Database["public"]["Enums"]["invoice_draft_status"]
        }
        Relationships: [
          {
            foreignKeyName: "invoice_draft_history_actor_membership_id_agency_organisat_fkey"
            columns: ["actor_membership_id", "agency_organisation_id"]
            isOneToOne: false
            referencedRelation: "organisation_memberships"
            referencedColumns: ["id", "organisation_id"]
          },
          {
            foreignKeyName: "invoice_draft_history_invoice_draft_id_agency_organisation_fkey"
            columns: ["invoice_draft_id", "agency_organisation_id"]
            isOneToOne: false
            referencedRelation: "invoice_drafts"
            referencedColumns: ["id", "agency_organisation_id"]
          },
        ]
      }
      invoice_draft_lines: {
        Row: {
          agency_facility_id: string
          agency_organisation_id: string
          agency_worker_id: string
          bill_amount_minor: number
          bill_overtime_minutes: number
          bill_rate_minor: number
          bill_regular_minutes: number
          calculation_version: number
          currency: string
          discipline_key: string
          discipline_name: string
          entry_id: string
          id: string
          invoice_draft_id: string
          line_number: number
          period_end: string
          period_start: string
          priced_line_id: string
          priced_minutes: number
          priced_timesheet_id: string
          profile_id: string
          relationship_id: string
          timesheet_id: string
          timesheet_revision: number
          work_date: string
          worker_name: string
          worker_reference: string | null
        }
        Insert: {
          agency_facility_id: string
          agency_organisation_id: string
          agency_worker_id: string
          bill_amount_minor: number
          bill_overtime_minutes: number
          bill_rate_minor: number
          bill_regular_minutes: number
          calculation_version: number
          currency: string
          discipline_key: string
          discipline_name: string
          entry_id: string
          id?: string
          invoice_draft_id: string
          line_number: number
          period_end: string
          period_start: string
          priced_line_id: string
          priced_minutes: number
          priced_timesheet_id: string
          profile_id: string
          relationship_id: string
          timesheet_id: string
          timesheet_revision: number
          work_date: string
          worker_name: string
          worker_reference?: string | null
        }
        Update: {
          agency_facility_id?: string
          agency_organisation_id?: string
          agency_worker_id?: string
          bill_amount_minor?: number
          bill_overtime_minutes?: number
          bill_rate_minor?: number
          bill_regular_minutes?: number
          calculation_version?: number
          currency?: string
          discipline_key?: string
          discipline_name?: string
          entry_id?: string
          id?: string
          invoice_draft_id?: string
          line_number?: number
          period_end?: string
          period_start?: string
          priced_line_id?: string
          priced_minutes?: number
          priced_timesheet_id?: string
          profile_id?: string
          relationship_id?: string
          timesheet_id?: string
          timesheet_revision?: number
          work_date?: string
          worker_name?: string
          worker_reference?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoice_draft_lines_invoice_draft_id_agency_organisation_i_fkey"
            columns: [
              "invoice_draft_id",
              "agency_organisation_id",
              "relationship_id",
              "agency_facility_id",
              "period_start",
              "period_end",
              "currency",
            ]
            isOneToOne: false
            referencedRelation: "invoice_drafts"
            referencedColumns: [
              "id",
              "agency_organisation_id",
              "relationship_id",
              "agency_facility_id",
              "period_start",
              "period_end",
              "currency",
            ]
          },
          {
            foreignKeyName: "invoice_draft_lines_priced_line_id_priced_timesheet_id_age_fkey"
            columns: [
              "priced_line_id",
              "priced_timesheet_id",
              "agency_organisation_id",
              "timesheet_id",
              "timesheet_revision",
              "entry_id",
              "agency_worker_id",
              "profile_id",
              "agency_facility_id",
              "relationship_id",
              "discipline_key",
              "work_date",
              "currency",
              "priced_minutes",
              "bill_regular_minutes",
              "bill_overtime_minutes",
              "bill_rate_minor",
              "bill_amount_minor",
              "calculation_version",
            ]
            isOneToOne: false
            referencedRelation: "priced_timesheet_lines"
            referencedColumns: [
              "id",
              "priced_timesheet_id",
              "agency_organisation_id",
              "timesheet_id",
              "timesheet_revision",
              "entry_id",
              "agency_worker_id",
              "profile_id",
              "agency_facility_id",
              "relationship_id",
              "discipline_key",
              "local_date",
              "currency",
              "priced_minutes",
              "bill_regular_minutes",
              "bill_overtime_minutes",
              "bill_rate_minor",
              "bill_amount_minor",
              "calculation_version",
            ]
          },
          {
            foreignKeyName: "invoice_draft_lines_priced_timesheet_id_agency_organisatio_fkey"
            columns: [
              "priced_timesheet_id",
              "agency_organisation_id",
              "period_start",
              "period_end",
              "currency",
            ]
            isOneToOne: false
            referencedRelation: "priced_timesheets"
            referencedColumns: [
              "id",
              "agency_organisation_id",
              "period_start",
              "period_end",
              "currency",
            ]
          },
        ]
      }
      invoice_drafts: {
        Row: {
          agency_facility_id: string
          agency_name: string
          agency_organisation_id: string
          approved_at: string | null
          approved_by_membership_id: string | null
          created_at: string
          created_by_membership_id: string
          currency: string
          exported_at: string | null
          facility_name: string
          id: string
          line_count: number
          locked_at: string | null
          locked_by_membership_id: string | null
          period_end: string
          period_start: string
          reference: string
          relationship_id: string
          reviewed_at: string | null
          reviewed_by_membership_id: string | null
          status: Database["public"]["Enums"]["invoice_draft_status"]
          status_changed_at: string
          total_bill_minor: number
          total_priced_minutes: number
          void_reason: string | null
          voided_at: string | null
          voided_by_membership_id: string | null
        }
        Insert: {
          agency_facility_id: string
          agency_name: string
          agency_organisation_id: string
          approved_at?: string | null
          approved_by_membership_id?: string | null
          created_at?: string
          created_by_membership_id: string
          currency: string
          exported_at?: string | null
          facility_name: string
          id?: string
          line_count: number
          locked_at?: string | null
          locked_by_membership_id?: string | null
          period_end: string
          period_start: string
          reference: string
          relationship_id: string
          reviewed_at?: string | null
          reviewed_by_membership_id?: string | null
          status?: Database["public"]["Enums"]["invoice_draft_status"]
          status_changed_at?: string
          total_bill_minor: number
          total_priced_minutes: number
          void_reason?: string | null
          voided_at?: string | null
          voided_by_membership_id?: string | null
        }
        Update: {
          agency_facility_id?: string
          agency_name?: string
          agency_organisation_id?: string
          approved_at?: string | null
          approved_by_membership_id?: string | null
          created_at?: string
          created_by_membership_id?: string
          currency?: string
          exported_at?: string | null
          facility_name?: string
          id?: string
          line_count?: number
          locked_at?: string | null
          locked_by_membership_id?: string | null
          period_end?: string
          period_start?: string
          reference?: string
          relationship_id?: string
          reviewed_at?: string | null
          reviewed_by_membership_id?: string | null
          status?: Database["public"]["Enums"]["invoice_draft_status"]
          status_changed_at?: string
          total_bill_minor?: number
          total_priced_minutes?: number
          void_reason?: string | null
          voided_at?: string | null
          voided_by_membership_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoice_drafts_approved_by_membership_id_agency_organisati_fkey"
            columns: ["approved_by_membership_id", "agency_organisation_id"]
            isOneToOne: false
            referencedRelation: "organisation_memberships"
            referencedColumns: ["id", "organisation_id"]
          },
          {
            foreignKeyName: "invoice_drafts_created_by_membership_id_agency_organisatio_fkey"
            columns: ["created_by_membership_id", "agency_organisation_id"]
            isOneToOne: false
            referencedRelation: "organisation_memberships"
            referencedColumns: ["id", "organisation_id"]
          },
          {
            foreignKeyName: "invoice_drafts_currency_fkey"
            columns: ["currency"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "invoice_drafts_locked_by_membership_id_agency_organisation_fkey"
            columns: ["locked_by_membership_id", "agency_organisation_id"]
            isOneToOne: false
            referencedRelation: "organisation_memberships"
            referencedColumns: ["id", "organisation_id"]
          },
          {
            foreignKeyName: "invoice_drafts_relationship_id_agency_organisation_id_agen_fkey"
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
          {
            foreignKeyName: "invoice_drafts_reviewed_by_membership_id_agency_organisati_fkey"
            columns: ["reviewed_by_membership_id", "agency_organisation_id"]
            isOneToOne: false
            referencedRelation: "organisation_memberships"
            referencedColumns: ["id", "organisation_id"]
          },
          {
            foreignKeyName: "invoice_drafts_voided_by_membership_id_agency_organisation_fkey"
            columns: ["voided_by_membership_id", "agency_organisation_id"]
            isOneToOne: false
            referencedRelation: "organisation_memberships"
            referencedColumns: ["id", "organisation_id"]
          },
        ]
      }
      invoice_line_claims: {
        Row: {
          agency_organisation_id: string
          claimed_at: string
          invoice_draft_id: string
          invoice_draft_line_id: string
          priced_line_id: string
          timesheet_id: string
          timesheet_revision: number
        }
        Insert: {
          agency_organisation_id: string
          claimed_at?: string
          invoice_draft_id: string
          invoice_draft_line_id: string
          priced_line_id: string
          timesheet_id: string
          timesheet_revision: number
        }
        Update: {
          agency_organisation_id?: string
          claimed_at?: string
          invoice_draft_id?: string
          invoice_draft_line_id?: string
          priced_line_id?: string
          timesheet_id?: string
          timesheet_revision?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoice_line_claims_invoice_draft_line_id_invoice_draft_id_fkey"
            columns: [
              "invoice_draft_line_id",
              "invoice_draft_id",
              "agency_organisation_id",
              "priced_line_id",
              "timesheet_id",
              "timesheet_revision",
            ]
            isOneToOne: false
            referencedRelation: "invoice_draft_lines"
            referencedColumns: [
              "id",
              "invoice_draft_id",
              "agency_organisation_id",
              "priced_line_id",
              "timesheet_id",
              "timesheet_revision",
            ]
          },
        ]
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
      location_geofences: {
        Row: {
          agency_facility_id: string
          agency_organisation_id: string
          created_at: string
          enabled: boolean
          facility_location_id: string
          latitude: number
          longitude: number
          max_accuracy_meters: number
          outside_policy: Database["public"]["Enums"]["geofence_outside_policy"]
          radius_meters: number
          updated_at: string
          updated_by_profile_id: string | null
        }
        Insert: {
          agency_facility_id: string
          agency_organisation_id: string
          created_at?: string
          enabled?: boolean
          facility_location_id: string
          latitude: number
          longitude: number
          max_accuracy_meters?: number
          outside_policy?: Database["public"]["Enums"]["geofence_outside_policy"]
          radius_meters: number
          updated_at?: string
          updated_by_profile_id?: string | null
        }
        Update: {
          agency_facility_id?: string
          agency_organisation_id?: string
          created_at?: string
          enabled?: boolean
          facility_location_id?: string
          latitude?: number
          longitude?: number
          max_accuracy_meters?: number
          outside_policy?: Database["public"]["Enums"]["geofence_outside_policy"]
          radius_meters?: number
          updated_at?: string
          updated_by_profile_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "location_geofences_agency_facility_id_agency_organisation__fkey"
            columns: ["agency_facility_id", "agency_organisation_id"]
            isOneToOne: false
            referencedRelation: "agency_facilities"
            referencedColumns: ["id", "agency_organisation_id"]
          },
          {
            foreignKeyName: "location_geofences_facility_location_id_agency_facility_id_fkey"
            columns: ["facility_location_id", "agency_facility_id"]
            isOneToOne: false
            referencedRelation: "facility_locations"
            referencedColumns: ["id", "agency_facility_id"]
          },
          {
            foreignKeyName: "location_geofences_updated_by_profile_id_fkey"
            columns: ["updated_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
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
      overtime_policy_versions: {
        Row: {
          activated_at: string | null
          activated_by_membership_id: string | null
          agency_organisation_id: string
          agency_organisation_type: Database["public"]["Enums"]["organisation_type"]
          created_at: string
          created_by_membership_id: string
          discarded_at: string | null
          effective_from: string
          id: string
          mode: Database["public"]["Enums"]["overtime_mode"]
          multiplier_denominator: number | null
          multiplier_numerator: number | null
          side: Database["public"]["Enums"]["pricing_side"]
          status: Database["public"]["Enums"]["rate_version_status"]
          version: number
          weekly_threshold_minutes: number | null
        }
        Insert: {
          activated_at?: string | null
          activated_by_membership_id?: string | null
          agency_organisation_id: string
          agency_organisation_type?: Database["public"]["Enums"]["organisation_type"]
          created_at?: string
          created_by_membership_id: string
          discarded_at?: string | null
          effective_from: string
          id?: string
          mode: Database["public"]["Enums"]["overtime_mode"]
          multiplier_denominator?: number | null
          multiplier_numerator?: number | null
          side: Database["public"]["Enums"]["pricing_side"]
          status?: Database["public"]["Enums"]["rate_version_status"]
          version: number
          weekly_threshold_minutes?: number | null
        }
        Update: {
          activated_at?: string | null
          activated_by_membership_id?: string | null
          agency_organisation_id?: string
          agency_organisation_type?: Database["public"]["Enums"]["organisation_type"]
          created_at?: string
          created_by_membership_id?: string
          discarded_at?: string | null
          effective_from?: string
          id?: string
          mode?: Database["public"]["Enums"]["overtime_mode"]
          multiplier_denominator?: number | null
          multiplier_numerator?: number | null
          side?: Database["public"]["Enums"]["pricing_side"]
          status?: Database["public"]["Enums"]["rate_version_status"]
          version?: number
          weekly_threshold_minutes?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "overtime_policy_versions_activated_by_membership_id_agency_fkey"
            columns: ["activated_by_membership_id", "agency_organisation_id"]
            isOneToOne: false
            referencedRelation: "organisation_memberships"
            referencedColumns: ["id", "organisation_id"]
          },
          {
            foreignKeyName: "overtime_policy_versions_agency_organisation_id_agency_org_fkey"
            columns: ["agency_organisation_id", "agency_organisation_type"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id", "type"]
          },
          {
            foreignKeyName: "overtime_policy_versions_created_by_membership_id_agency_o_fkey"
            columns: ["created_by_membership_id", "agency_organisation_id"]
            isOneToOne: false
            referencedRelation: "organisation_memberships"
            referencedColumns: ["id", "organisation_id"]
          },
        ]
      }
      payroll_batch_history: {
        Row: {
          action: string
          actor_membership_id: string
          agency_organisation_id: string
          from_status:
            | Database["public"]["Enums"]["payroll_batch_status"]
            | null
          id: string
          note: string | null
          occurred_at: string
          payroll_batch_id: string
          to_status: Database["public"]["Enums"]["payroll_batch_status"]
        }
        Insert: {
          action: string
          actor_membership_id: string
          agency_organisation_id: string
          from_status?:
            | Database["public"]["Enums"]["payroll_batch_status"]
            | null
          id?: string
          note?: string | null
          occurred_at?: string
          payroll_batch_id: string
          to_status: Database["public"]["Enums"]["payroll_batch_status"]
        }
        Update: {
          action?: string
          actor_membership_id?: string
          agency_organisation_id?: string
          from_status?:
            | Database["public"]["Enums"]["payroll_batch_status"]
            | null
          id?: string
          note?: string | null
          occurred_at?: string
          payroll_batch_id?: string
          to_status?: Database["public"]["Enums"]["payroll_batch_status"]
        }
        Relationships: [
          {
            foreignKeyName: "payroll_batch_history_actor_membership_id_agency_organisat_fkey"
            columns: ["actor_membership_id", "agency_organisation_id"]
            isOneToOne: false
            referencedRelation: "organisation_memberships"
            referencedColumns: ["id", "organisation_id"]
          },
          {
            foreignKeyName: "payroll_batch_history_payroll_batch_id_agency_organisation_fkey"
            columns: ["payroll_batch_id", "agency_organisation_id"]
            isOneToOne: false
            referencedRelation: "payroll_batches"
            referencedColumns: ["id", "agency_organisation_id"]
          },
        ]
      }
      payroll_batch_lines: {
        Row: {
          agency_facility_id: string
          agency_organisation_id: string
          agency_worker_id: string
          calculation_version: number
          currency: string
          discipline_key: string
          discipline_name: string
          entry_id: string
          facility_name: string
          id: string
          line_number: number
          overtime_minutes: number
          pay_amount_minor: number
          pay_rate_minor: number
          payroll_batch_id: string
          period_end: string
          period_start: string
          priced_line_id: string
          priced_timesheet_id: string
          profile_id: string
          regular_minutes: number
          relationship_id: string
          timesheet_id: string
          timesheet_revision: number
          work_date: string
          worker_name: string
          worker_reference: string | null
        }
        Insert: {
          agency_facility_id: string
          agency_organisation_id: string
          agency_worker_id: string
          calculation_version: number
          currency: string
          discipline_key: string
          discipline_name: string
          entry_id: string
          facility_name: string
          id?: string
          line_number: number
          overtime_minutes: number
          pay_amount_minor: number
          pay_rate_minor: number
          payroll_batch_id: string
          period_end: string
          period_start: string
          priced_line_id: string
          priced_timesheet_id: string
          profile_id: string
          regular_minutes: number
          relationship_id: string
          timesheet_id: string
          timesheet_revision: number
          work_date: string
          worker_name: string
          worker_reference?: string | null
        }
        Update: {
          agency_facility_id?: string
          agency_organisation_id?: string
          agency_worker_id?: string
          calculation_version?: number
          currency?: string
          discipline_key?: string
          discipline_name?: string
          entry_id?: string
          facility_name?: string
          id?: string
          line_number?: number
          overtime_minutes?: number
          pay_amount_minor?: number
          pay_rate_minor?: number
          payroll_batch_id?: string
          period_end?: string
          period_start?: string
          priced_line_id?: string
          priced_timesheet_id?: string
          profile_id?: string
          regular_minutes?: number
          relationship_id?: string
          timesheet_id?: string
          timesheet_revision?: number
          work_date?: string
          worker_name?: string
          worker_reference?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payroll_batch_lines_agency_worker_id_agency_organisation_i_fkey"
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
            foreignKeyName: "payroll_batch_lines_payroll_batch_id_agency_organisation_i_fkey"
            columns: [
              "payroll_batch_id",
              "agency_organisation_id",
              "period_start",
              "period_end",
              "currency",
            ]
            isOneToOne: false
            referencedRelation: "payroll_batches"
            referencedColumns: [
              "id",
              "agency_organisation_id",
              "period_start",
              "period_end",
              "currency",
            ]
          },
          {
            foreignKeyName: "payroll_batch_lines_priced_line_id_priced_timesheet_id_age_fkey"
            columns: [
              "priced_line_id",
              "priced_timesheet_id",
              "agency_organisation_id",
              "timesheet_id",
              "timesheet_revision",
              "entry_id",
              "agency_worker_id",
              "profile_id",
              "agency_facility_id",
              "relationship_id",
              "discipline_key",
              "work_date",
              "currency",
              "regular_minutes",
              "overtime_minutes",
              "pay_rate_minor",
              "pay_amount_minor",
              "calculation_version",
            ]
            isOneToOne: false
            referencedRelation: "priced_timesheet_lines"
            referencedColumns: [
              "id",
              "priced_timesheet_id",
              "agency_organisation_id",
              "timesheet_id",
              "timesheet_revision",
              "entry_id",
              "agency_worker_id",
              "profile_id",
              "agency_facility_id",
              "relationship_id",
              "discipline_key",
              "local_date",
              "currency",
              "pay_regular_minutes",
              "pay_overtime_minutes",
              "pay_rate_minor",
              "pay_amount_minor",
              "calculation_version",
            ]
          },
        ]
      }
      payroll_batches: {
        Row: {
          agency_organisation_id: string
          approved_at: string | null
          approved_by_membership_id: string | null
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by_membership_id: string | null
          created_at: string
          created_by_membership_id: string
          currency: string
          exported_at: string | null
          id: string
          line_count: number
          locked_at: string | null
          locked_by_membership_id: string | null
          payroll_period_id: string
          period_end: string
          period_start: string
          reference: string
          reviewed_at: string | null
          reviewed_by_membership_id: string | null
          status: Database["public"]["Enums"]["payroll_batch_status"]
          status_changed_at: string
          total_overtime_minutes: number
          total_pay_minor: number
          total_regular_minutes: number
          worker_count: number
        }
        Insert: {
          agency_organisation_id: string
          approved_at?: string | null
          approved_by_membership_id?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by_membership_id?: string | null
          created_at?: string
          created_by_membership_id: string
          currency: string
          exported_at?: string | null
          id?: string
          line_count: number
          locked_at?: string | null
          locked_by_membership_id?: string | null
          payroll_period_id: string
          period_end: string
          period_start: string
          reference: string
          reviewed_at?: string | null
          reviewed_by_membership_id?: string | null
          status?: Database["public"]["Enums"]["payroll_batch_status"]
          status_changed_at?: string
          total_overtime_minutes: number
          total_pay_minor: number
          total_regular_minutes: number
          worker_count: number
        }
        Update: {
          agency_organisation_id?: string
          approved_at?: string | null
          approved_by_membership_id?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by_membership_id?: string | null
          created_at?: string
          created_by_membership_id?: string
          currency?: string
          exported_at?: string | null
          id?: string
          line_count?: number
          locked_at?: string | null
          locked_by_membership_id?: string | null
          payroll_period_id?: string
          period_end?: string
          period_start?: string
          reference?: string
          reviewed_at?: string | null
          reviewed_by_membership_id?: string | null
          status?: Database["public"]["Enums"]["payroll_batch_status"]
          status_changed_at?: string
          total_overtime_minutes?: number
          total_pay_minor?: number
          total_regular_minutes?: number
          worker_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "payroll_batches_approved_by_membership_id_agency_organisat_fkey"
            columns: ["approved_by_membership_id", "agency_organisation_id"]
            isOneToOne: false
            referencedRelation: "organisation_memberships"
            referencedColumns: ["id", "organisation_id"]
          },
          {
            foreignKeyName: "payroll_batches_cancelled_by_membership_id_agency_organisa_fkey"
            columns: ["cancelled_by_membership_id", "agency_organisation_id"]
            isOneToOne: false
            referencedRelation: "organisation_memberships"
            referencedColumns: ["id", "organisation_id"]
          },
          {
            foreignKeyName: "payroll_batches_created_by_membership_id_agency_organisati_fkey"
            columns: ["created_by_membership_id", "agency_organisation_id"]
            isOneToOne: false
            referencedRelation: "organisation_memberships"
            referencedColumns: ["id", "organisation_id"]
          },
          {
            foreignKeyName: "payroll_batches_currency_fkey"
            columns: ["currency"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "payroll_batches_locked_by_membership_id_agency_organisatio_fkey"
            columns: ["locked_by_membership_id", "agency_organisation_id"]
            isOneToOne: false
            referencedRelation: "organisation_memberships"
            referencedColumns: ["id", "organisation_id"]
          },
          {
            foreignKeyName: "payroll_batches_payroll_period_id_agency_organisation_id_p_fkey"
            columns: [
              "payroll_period_id",
              "agency_organisation_id",
              "period_start",
              "period_end",
            ]
            isOneToOne: false
            referencedRelation: "payroll_periods"
            referencedColumns: [
              "id",
              "agency_organisation_id",
              "period_start",
              "period_end",
            ]
          },
          {
            foreignKeyName: "payroll_batches_reviewed_by_membership_id_agency_organisat_fkey"
            columns: ["reviewed_by_membership_id", "agency_organisation_id"]
            isOneToOne: false
            referencedRelation: "organisation_memberships"
            referencedColumns: ["id", "organisation_id"]
          },
        ]
      }
      payroll_line_claims: {
        Row: {
          agency_organisation_id: string
          claimed_at: string
          payroll_batch_id: string
          payroll_batch_line_id: string
          priced_line_id: string
          timesheet_id: string
          timesheet_revision: number
        }
        Insert: {
          agency_organisation_id: string
          claimed_at?: string
          payroll_batch_id: string
          payroll_batch_line_id: string
          priced_line_id: string
          timesheet_id: string
          timesheet_revision: number
        }
        Update: {
          agency_organisation_id?: string
          claimed_at?: string
          payroll_batch_id?: string
          payroll_batch_line_id?: string
          priced_line_id?: string
          timesheet_id?: string
          timesheet_revision?: number
        }
        Relationships: [
          {
            foreignKeyName: "payroll_line_claims_payroll_batch_line_id_payroll_batch_id_fkey"
            columns: [
              "payroll_batch_line_id",
              "payroll_batch_id",
              "agency_organisation_id",
              "priced_line_id",
              "timesheet_id",
              "timesheet_revision",
            ]
            isOneToOne: false
            referencedRelation: "payroll_batch_lines"
            referencedColumns: [
              "id",
              "payroll_batch_id",
              "agency_organisation_id",
              "priced_line_id",
              "timesheet_id",
              "timesheet_revision",
            ]
          },
        ]
      }
      payroll_periods: {
        Row: {
          agency_organisation_id: string
          created_at: string
          id: string
          period_end: string
          period_start: string
          period_type: Database["public"]["Enums"]["payroll_period_type"]
        }
        Insert: {
          agency_organisation_id: string
          created_at?: string
          id?: string
          period_end: string
          period_start: string
          period_type: Database["public"]["Enums"]["payroll_period_type"]
        }
        Update: {
          agency_organisation_id?: string
          created_at?: string
          id?: string
          period_end?: string
          period_start?: string
          period_type?: Database["public"]["Enums"]["payroll_period_type"]
        }
        Relationships: [
          {
            foreignKeyName: "payroll_periods_agency_organisation_id_fkey"
            columns: ["agency_organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
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
      priced_timesheet_lines: {
        Row: {
          agency_facility_id: string
          agency_organisation_id: string
          agency_worker_id: string
          assignment_id: string
          bill_amount_minor: number
          bill_overtime_denominator: number | null
          bill_overtime_minutes: number
          bill_overtime_numerator: number | null
          bill_rate_minor: number
          bill_regular_minutes: number
          calculation_version: number
          classification: Database["public"]["Enums"]["shift_classification"]
          currency: string
          discipline_key: string
          entry_id: string
          id: string
          line_number: number
          local_date: string
          pay_amount_minor: number
          pay_overtime_denominator: number | null
          pay_overtime_minutes: number
          pay_overtime_numerator: number | null
          pay_rate_minor: number
          pay_regular_minutes: number
          priced_minutes: number
          priced_timesheet_id: string
          profile_id: string
          rate_card_id: string
          rate_precedence: number
          rate_version_id: string
          raw_minutes: number
          relationship_id: string
          rounding_increment_minutes: number | null
          rounding_mode: Database["public"]["Enums"]["rounding_mode"]
          rounding_policy_version_id: string | null
          shift_id: string
          timesheet_id: string
          timesheet_revision: number
        }
        Insert: {
          agency_facility_id: string
          agency_organisation_id: string
          agency_worker_id: string
          assignment_id: string
          bill_amount_minor: number
          bill_overtime_denominator?: number | null
          bill_overtime_minutes: number
          bill_overtime_numerator?: number | null
          bill_rate_minor: number
          bill_regular_minutes: number
          calculation_version: number
          classification: Database["public"]["Enums"]["shift_classification"]
          currency: string
          discipline_key: string
          entry_id: string
          id?: string
          line_number: number
          local_date: string
          pay_amount_minor: number
          pay_overtime_denominator?: number | null
          pay_overtime_minutes: number
          pay_overtime_numerator?: number | null
          pay_rate_minor: number
          pay_regular_minutes: number
          priced_minutes: number
          priced_timesheet_id: string
          profile_id: string
          rate_card_id: string
          rate_precedence: number
          rate_version_id: string
          raw_minutes: number
          relationship_id: string
          rounding_increment_minutes?: number | null
          rounding_mode: Database["public"]["Enums"]["rounding_mode"]
          rounding_policy_version_id?: string | null
          shift_id: string
          timesheet_id: string
          timesheet_revision: number
        }
        Update: {
          agency_facility_id?: string
          agency_organisation_id?: string
          agency_worker_id?: string
          assignment_id?: string
          bill_amount_minor?: number
          bill_overtime_denominator?: number | null
          bill_overtime_minutes?: number
          bill_overtime_numerator?: number | null
          bill_rate_minor?: number
          bill_regular_minutes?: number
          calculation_version?: number
          classification?: Database["public"]["Enums"]["shift_classification"]
          currency?: string
          discipline_key?: string
          entry_id?: string
          id?: string
          line_number?: number
          local_date?: string
          pay_amount_minor?: number
          pay_overtime_denominator?: number | null
          pay_overtime_minutes?: number
          pay_overtime_numerator?: number | null
          pay_rate_minor?: number
          pay_regular_minutes?: number
          priced_minutes?: number
          priced_timesheet_id?: string
          profile_id?: string
          rate_card_id?: string
          rate_precedence?: number
          rate_version_id?: string
          raw_minutes?: number
          relationship_id?: string
          rounding_increment_minutes?: number | null
          rounding_mode?: Database["public"]["Enums"]["rounding_mode"]
          rounding_policy_version_id?: string | null
          shift_id?: string
          timesheet_id?: string
          timesheet_revision?: number
        }
        Relationships: [
          {
            foreignKeyName: "priced_timesheet_lines_entry_id_timesheet_id_assignment_id_fkey"
            columns: [
              "entry_id",
              "timesheet_id",
              "assignment_id",
              "shift_id",
              "agency_worker_id",
              "profile_id",
              "relationship_id",
              "agency_facility_id",
            ]
            isOneToOne: false
            referencedRelation: "timesheet_entries"
            referencedColumns: [
              "id",
              "timesheet_id",
              "assignment_id",
              "shift_id",
              "agency_worker_id",
              "profile_id",
              "relationship_id",
              "agency_facility_id",
            ]
          },
          {
            foreignKeyName: "priced_timesheet_lines_priced_timesheet_id_agency_organisa_fkey"
            columns: [
              "priced_timesheet_id",
              "agency_organisation_id",
              "timesheet_id",
              "timesheet_revision",
            ]
            isOneToOne: false
            referencedRelation: "priced_timesheets"
            referencedColumns: [
              "id",
              "agency_organisation_id",
              "timesheet_id",
              "timesheet_revision",
            ]
          },
          {
            foreignKeyName: "priced_timesheet_lines_priced_timesheet_id_currency_fkey"
            columns: ["priced_timesheet_id", "currency"]
            isOneToOne: false
            referencedRelation: "priced_timesheets"
            referencedColumns: ["id", "currency"]
          },
          {
            foreignKeyName: "priced_timesheet_lines_rate_card_id_agency_organisation_id_fkey"
            columns: [
              "rate_card_id",
              "agency_organisation_id",
              "discipline_key",
            ]
            isOneToOne: false
            referencedRelation: "rate_cards"
            referencedColumns: [
              "id",
              "agency_organisation_id",
              "discipline_key",
            ]
          },
          {
            foreignKeyName: "priced_timesheet_lines_rate_version_id_currency_pay_rate_m_fkey"
            columns: [
              "rate_version_id",
              "currency",
              "pay_rate_minor",
              "bill_rate_minor",
            ]
            isOneToOne: false
            referencedRelation: "rate_card_versions"
            referencedColumns: [
              "id",
              "currency",
              "pay_rate_minor",
              "bill_rate_minor",
            ]
          },
          {
            foreignKeyName: "priced_timesheet_lines_rate_version_id_rate_card_id_agency_fkey"
            columns: [
              "rate_version_id",
              "rate_card_id",
              "agency_organisation_id",
            ]
            isOneToOne: false
            referencedRelation: "rate_card_versions"
            referencedColumns: ["id", "rate_card_id", "agency_organisation_id"]
          },
          {
            foreignKeyName: "priced_timesheet_lines_relationship_id_agency_organisation_fkey"
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
          {
            foreignKeyName: "priced_timesheet_lines_rounding_policy_version_id_agency_o_fkey"
            columns: ["rounding_policy_version_id", "agency_organisation_id"]
            isOneToOne: false
            referencedRelation: "rounding_policy_versions"
            referencedColumns: ["id", "agency_organisation_id"]
          },
          {
            foreignKeyName: "priced_timesheet_lines_shift_id_agency_organisation_id_dis_fkey"
            columns: [
              "shift_id",
              "agency_organisation_id",
              "discipline_key",
              "classification",
            ]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: [
              "id",
              "agency_organisation_id",
              "discipline_key",
              "classification",
            ]
          },
        ]
      }
      priced_timesheets: {
        Row: {
          agency_organisation_id: string
          agency_worker_id: string
          approval_id: string
          bill_overtime_policy_version_id: string | null
          bill_side: Database["public"]["Enums"]["pricing_side"] | null
          calculation_version: number
          currency: string
          id: string
          line_count: number
          pay_overtime_policy_version_id: string | null
          pay_side: Database["public"]["Enums"]["pricing_side"] | null
          period_end: string
          period_start: string
          priced_at: string
          priced_by_membership_id: string
          profile_id: string
          timesheet_id: string
          timesheet_revision: number
          total_bill_minor: number
          total_bill_overtime_minutes: number
          total_pay_minor: number
          total_pay_overtime_minutes: number
          total_priced_minutes: number
          total_raw_minutes: number
        }
        Insert: {
          agency_organisation_id: string
          agency_worker_id: string
          approval_id: string
          bill_overtime_policy_version_id?: string | null
          bill_side?: Database["public"]["Enums"]["pricing_side"] | null
          calculation_version: number
          currency: string
          id?: string
          line_count: number
          pay_overtime_policy_version_id?: string | null
          pay_side?: Database["public"]["Enums"]["pricing_side"] | null
          period_end: string
          period_start: string
          priced_at?: string
          priced_by_membership_id: string
          profile_id: string
          timesheet_id: string
          timesheet_revision: number
          total_bill_minor: number
          total_bill_overtime_minutes: number
          total_pay_minor: number
          total_pay_overtime_minutes: number
          total_priced_minutes: number
          total_raw_minutes: number
        }
        Update: {
          agency_organisation_id?: string
          agency_worker_id?: string
          approval_id?: string
          bill_overtime_policy_version_id?: string | null
          bill_side?: Database["public"]["Enums"]["pricing_side"] | null
          calculation_version?: number
          currency?: string
          id?: string
          line_count?: number
          pay_overtime_policy_version_id?: string | null
          pay_side?: Database["public"]["Enums"]["pricing_side"] | null
          period_end?: string
          period_start?: string
          priced_at?: string
          priced_by_membership_id?: string
          profile_id?: string
          timesheet_id?: string
          timesheet_revision?: number
          total_bill_minor?: number
          total_bill_overtime_minutes?: number
          total_pay_minor?: number
          total_pay_overtime_minutes?: number
          total_priced_minutes?: number
          total_raw_minutes?: number
        }
        Relationships: [
          {
            foreignKeyName: "priced_timesheets_approval_id_timesheet_id_timesheet_revis_fkey"
            columns: ["approval_id", "timesheet_id", "timesheet_revision"]
            isOneToOne: false
            referencedRelation: "timesheet_approvals"
            referencedColumns: ["id", "timesheet_id", "revision"]
          },
          {
            foreignKeyName: "priced_timesheets_bill_overtime_policy_version_id_agency_o_fkey"
            columns: [
              "bill_overtime_policy_version_id",
              "agency_organisation_id",
              "bill_side",
            ]
            isOneToOne: false
            referencedRelation: "overtime_policy_versions"
            referencedColumns: ["id", "agency_organisation_id", "side"]
          },
          {
            foreignKeyName: "priced_timesheets_currency_fkey"
            columns: ["currency"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "priced_timesheets_pay_overtime_policy_version_id_agency_or_fkey"
            columns: [
              "pay_overtime_policy_version_id",
              "agency_organisation_id",
              "pay_side",
            ]
            isOneToOne: false
            referencedRelation: "overtime_policy_versions"
            referencedColumns: ["id", "agency_organisation_id", "side"]
          },
          {
            foreignKeyName: "priced_timesheets_priced_by_membership_id_agency_organisat_fkey"
            columns: ["priced_by_membership_id", "agency_organisation_id"]
            isOneToOne: false
            referencedRelation: "organisation_memberships"
            referencedColumns: ["id", "organisation_id"]
          },
          {
            foreignKeyName: "priced_timesheets_timesheet_id_agency_organisation_id_agen_fkey"
            columns: [
              "timesheet_id",
              "agency_organisation_id",
              "agency_worker_id",
              "profile_id",
            ]
            isOneToOne: false
            referencedRelation: "timesheets"
            referencedColumns: [
              "id",
              "agency_organisation_id",
              "agency_worker_id",
              "profile_id",
            ]
          },
        ]
      }
      pricing_blocks: {
        Row: {
          agency_organisation_id: string
          attempts: number
          first_blocked_at: string
          issues: Json
          last_attempt_at: string
          resolved_at: string | null
          timesheet_id: string
          timesheet_revision: number
        }
        Insert: {
          agency_organisation_id: string
          attempts?: number
          first_blocked_at?: string
          issues: Json
          last_attempt_at?: string
          resolved_at?: string | null
          timesheet_id: string
          timesheet_revision: number
        }
        Update: {
          agency_organisation_id?: string
          attempts?: number
          first_blocked_at?: string
          issues?: Json
          last_attempt_at?: string
          resolved_at?: string | null
          timesheet_id?: string
          timesheet_revision?: number
        }
        Relationships: [
          {
            foreignKeyName: "pricing_blocks_timesheet_id_agency_organisation_id_fkey"
            columns: ["timesheet_id", "agency_organisation_id"]
            isOneToOne: false
            referencedRelation: "timesheets"
            referencedColumns: ["id", "agency_organisation_id"]
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
      rate_card_versions: {
        Row: {
          activated_at: string | null
          activated_by_membership_id: string | null
          agency_organisation_id: string
          bill_rate_minor: number
          created_at: string
          created_by_membership_id: string
          currency: string
          discarded_at: string | null
          effective_from: string
          effective_period: unknown
          effective_to: string | null
          id: string
          pay_rate_minor: number
          rate_card_id: string
          status: Database["public"]["Enums"]["rate_version_status"]
          superseded_from: string | null
          version: number
        }
        Insert: {
          activated_at?: string | null
          activated_by_membership_id?: string | null
          agency_organisation_id: string
          bill_rate_minor: number
          created_at?: string
          created_by_membership_id: string
          currency: string
          discarded_at?: string | null
          effective_from: string
          effective_period?: unknown
          effective_to?: string | null
          id?: string
          pay_rate_minor: number
          rate_card_id: string
          status?: Database["public"]["Enums"]["rate_version_status"]
          superseded_from?: string | null
          version: number
        }
        Update: {
          activated_at?: string | null
          activated_by_membership_id?: string | null
          agency_organisation_id?: string
          bill_rate_minor?: number
          created_at?: string
          created_by_membership_id?: string
          currency?: string
          discarded_at?: string | null
          effective_from?: string
          effective_period?: unknown
          effective_to?: string | null
          id?: string
          pay_rate_minor?: number
          rate_card_id?: string
          status?: Database["public"]["Enums"]["rate_version_status"]
          superseded_from?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "rate_card_versions_activated_by_membership_id_agency_organ_fkey"
            columns: ["activated_by_membership_id", "agency_organisation_id"]
            isOneToOne: false
            referencedRelation: "organisation_memberships"
            referencedColumns: ["id", "organisation_id"]
          },
          {
            foreignKeyName: "rate_card_versions_created_by_membership_id_agency_organis_fkey"
            columns: ["created_by_membership_id", "agency_organisation_id"]
            isOneToOne: false
            referencedRelation: "organisation_memberships"
            referencedColumns: ["id", "organisation_id"]
          },
          {
            foreignKeyName: "rate_card_versions_currency_fkey"
            columns: ["currency"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "rate_card_versions_rate_card_id_agency_organisation_id_fkey"
            columns: ["rate_card_id", "agency_organisation_id"]
            isOneToOne: false
            referencedRelation: "rate_cards"
            referencedColumns: ["id", "agency_organisation_id"]
          },
        ]
      }
      rate_cards: {
        Row: {
          agency_organisation_id: string
          agency_organisation_type: Database["public"]["Enums"]["organisation_type"]
          classification:
            | Database["public"]["Enums"]["shift_classification"]
            | null
          created_at: string
          created_by_membership_id: string
          discipline_key: string
          id: string
          relationship_id: string | null
        }
        Insert: {
          agency_organisation_id: string
          agency_organisation_type?: Database["public"]["Enums"]["organisation_type"]
          classification?:
            | Database["public"]["Enums"]["shift_classification"]
            | null
          created_at?: string
          created_by_membership_id: string
          discipline_key: string
          id?: string
          relationship_id?: string | null
        }
        Update: {
          agency_organisation_id?: string
          agency_organisation_type?: Database["public"]["Enums"]["organisation_type"]
          classification?:
            | Database["public"]["Enums"]["shift_classification"]
            | null
          created_at?: string
          created_by_membership_id?: string
          discipline_key?: string
          id?: string
          relationship_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rate_cards_agency_organisation_id_agency_organisation_type_fkey"
            columns: ["agency_organisation_id", "agency_organisation_type"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id", "type"]
          },
          {
            foreignKeyName: "rate_cards_created_by_membership_id_agency_organisation_id_fkey"
            columns: ["created_by_membership_id", "agency_organisation_id"]
            isOneToOne: false
            referencedRelation: "organisation_memberships"
            referencedColumns: ["id", "organisation_id"]
          },
          {
            foreignKeyName: "rate_cards_discipline_key_fkey"
            columns: ["discipline_key"]
            isOneToOne: false
            referencedRelation: "disciplines"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "rate_cards_relationship_id_agency_organisation_id_fkey"
            columns: ["relationship_id", "agency_organisation_id"]
            isOneToOne: false
            referencedRelation: "agency_facility_relationships"
            referencedColumns: ["id", "agency_organisation_id"]
          },
        ]
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
      rounding_policy_versions: {
        Row: {
          activated_at: string | null
          activated_by_membership_id: string | null
          agency_organisation_id: string
          agency_organisation_type: Database["public"]["Enums"]["organisation_type"]
          created_at: string
          created_by_membership_id: string
          discarded_at: string | null
          effective_from: string
          id: string
          increment_minutes: number | null
          mode: Database["public"]["Enums"]["rounding_mode"]
          status: Database["public"]["Enums"]["rate_version_status"]
          version: number
        }
        Insert: {
          activated_at?: string | null
          activated_by_membership_id?: string | null
          agency_organisation_id: string
          agency_organisation_type?: Database["public"]["Enums"]["organisation_type"]
          created_at?: string
          created_by_membership_id: string
          discarded_at?: string | null
          effective_from: string
          id?: string
          increment_minutes?: number | null
          mode: Database["public"]["Enums"]["rounding_mode"]
          status?: Database["public"]["Enums"]["rate_version_status"]
          version: number
        }
        Update: {
          activated_at?: string | null
          activated_by_membership_id?: string | null
          agency_organisation_id?: string
          agency_organisation_type?: Database["public"]["Enums"]["organisation_type"]
          created_at?: string
          created_by_membership_id?: string
          discarded_at?: string | null
          effective_from?: string
          id?: string
          increment_minutes?: number | null
          mode?: Database["public"]["Enums"]["rounding_mode"]
          status?: Database["public"]["Enums"]["rate_version_status"]
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "rounding_policy_versions_activated_by_membership_id_agency_fkey"
            columns: ["activated_by_membership_id", "agency_organisation_id"]
            isOneToOne: false
            referencedRelation: "organisation_memberships"
            referencedColumns: ["id", "organisation_id"]
          },
          {
            foreignKeyName: "rounding_policy_versions_agency_organisation_id_agency_org_fkey"
            columns: ["agency_organisation_id", "agency_organisation_type"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id", "type"]
          },
          {
            foreignKeyName: "rounding_policy_versions_created_by_membership_id_agency_o_fkey"
            columns: ["created_by_membership_id", "agency_organisation_id"]
            isOneToOne: false
            referencedRelation: "organisation_memberships"
            referencedColumns: ["id", "organisation_id"]
          },
        ]
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
          classification: Database["public"]["Enums"]["shift_classification"]
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
          classification?: Database["public"]["Enums"]["shift_classification"]
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
          classification?: Database["public"]["Enums"]["shift_classification"]
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
      timesheet_approvals: {
        Row: {
          agency_organisation_id: string
          approved_at: string
          approved_by_membership_id: string
          calculation_version: number
          entry_count: number
          id: string
          revision: number
          snapshot: Json
          superseded_at: string | null
          timesheet_id: string
          total_break_minutes: number
          total_worked_minutes: number
        }
        Insert: {
          agency_organisation_id: string
          approved_at?: string
          approved_by_membership_id: string
          calculation_version: number
          entry_count: number
          id?: string
          revision: number
          snapshot: Json
          superseded_at?: string | null
          timesheet_id: string
          total_break_minutes: number
          total_worked_minutes: number
        }
        Update: {
          agency_organisation_id?: string
          approved_at?: string
          approved_by_membership_id?: string
          calculation_version?: number
          entry_count?: number
          id?: string
          revision?: number
          snapshot?: Json
          superseded_at?: string | null
          timesheet_id?: string
          total_break_minutes?: number
          total_worked_minutes?: number
        }
        Relationships: [
          {
            foreignKeyName: "timesheet_approvals_approved_by_membership_id_agency_organ_fkey"
            columns: ["approved_by_membership_id", "agency_organisation_id"]
            isOneToOne: false
            referencedRelation: "organisation_memberships"
            referencedColumns: ["id", "organisation_id"]
          },
          {
            foreignKeyName: "timesheet_approvals_timesheet_id_agency_organisation_id_fkey"
            columns: ["timesheet_id", "agency_organisation_id"]
            isOneToOne: false
            referencedRelation: "timesheets"
            referencedColumns: ["id", "agency_organisation_id"]
          },
        ]
      }
      timesheet_entries: {
        Row: {
          agency_facility_id: string
          agency_organisation_id: string
          agency_worker_id: string
          assignment_id: string
          attendance_id: string | null
          blocking_reasons: string[]
          break_minutes: number | null
          breaks: Json
          calculated_at: string
          calculation_version: number
          complete: boolean
          created_at: string
          effective_end_at: string | null
          effective_start_at: string | null
          facility_location_id: string
          facility_organisation_id: string | null
          facility_state: Database["public"]["Enums"]["timesheet_facility_state"]
          id: string
          included: boolean
          local_date: string
          not_worked: boolean
          open_exception_types: string[]
          pending_corrections: number
          profile_id: string
          relationship_id: string
          revision: number
          scheduled_end_at: string
          scheduled_start_at: string
          shift_id: string
          timesheet_id: string
          timezone: string
          updated_at: string
          worked_minutes: number | null
        }
        Insert: {
          agency_facility_id: string
          agency_organisation_id: string
          agency_worker_id: string
          assignment_id: string
          attendance_id?: string | null
          blocking_reasons?: string[]
          break_minutes?: number | null
          breaks?: Json
          calculated_at?: string
          calculation_version?: number
          complete?: boolean
          created_at?: string
          effective_end_at?: string | null
          effective_start_at?: string | null
          facility_location_id: string
          facility_organisation_id?: string | null
          facility_state?: Database["public"]["Enums"]["timesheet_facility_state"]
          id?: string
          included?: boolean
          local_date: string
          not_worked?: boolean
          open_exception_types?: string[]
          pending_corrections?: number
          profile_id: string
          relationship_id: string
          revision?: number
          scheduled_end_at: string
          scheduled_start_at: string
          shift_id: string
          timesheet_id: string
          timezone: string
          updated_at?: string
          worked_minutes?: number | null
        }
        Update: {
          agency_facility_id?: string
          agency_organisation_id?: string
          agency_worker_id?: string
          assignment_id?: string
          attendance_id?: string | null
          blocking_reasons?: string[]
          break_minutes?: number | null
          breaks?: Json
          calculated_at?: string
          calculation_version?: number
          complete?: boolean
          created_at?: string
          effective_end_at?: string | null
          effective_start_at?: string | null
          facility_location_id?: string
          facility_organisation_id?: string | null
          facility_state?: Database["public"]["Enums"]["timesheet_facility_state"]
          id?: string
          included?: boolean
          local_date?: string
          not_worked?: boolean
          open_exception_types?: string[]
          pending_corrections?: number
          profile_id?: string
          relationship_id?: string
          revision?: number
          scheduled_end_at?: string
          scheduled_start_at?: string
          shift_id?: string
          timesheet_id?: string
          timezone?: string
          updated_at?: string
          worked_minutes?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "timesheet_entries_agency_facility_id_facility_organisation_fkey"
            columns: ["agency_facility_id", "facility_organisation_id"]
            isOneToOne: false
            referencedRelation: "agency_facilities"
            referencedColumns: ["id", "linked_facility_organisation_id"]
          },
          {
            foreignKeyName: "timesheet_entries_assignment_id_agency_organisation_id_shi_fkey"
            columns: [
              "assignment_id",
              "agency_organisation_id",
              "shift_id",
              "agency_worker_id",
              "profile_id",
            ]
            isOneToOne: false
            referencedRelation: "shift_assignments"
            referencedColumns: [
              "id",
              "agency_organisation_id",
              "shift_id",
              "agency_worker_id",
              "profile_id",
            ]
          },
          {
            foreignKeyName: "timesheet_entries_attendance_id_assignment_id_fkey"
            columns: ["attendance_id", "assignment_id"]
            isOneToOne: false
            referencedRelation: "assignment_attendance"
            referencedColumns: ["id", "assignment_id"]
          },
          {
            foreignKeyName: "timesheet_entries_shift_id_agency_organisation_id_relation_fkey"
            columns: [
              "shift_id",
              "agency_organisation_id",
              "relationship_id",
              "agency_facility_id",
              "facility_location_id",
            ]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: [
              "id",
              "agency_organisation_id",
              "relationship_id",
              "agency_facility_id",
              "facility_location_id",
            ]
          },
          {
            foreignKeyName: "timesheet_entries_timesheet_id_agency_organisation_id_agen_fkey"
            columns: [
              "timesheet_id",
              "agency_organisation_id",
              "agency_worker_id",
              "profile_id",
            ]
            isOneToOne: false
            referencedRelation: "timesheets"
            referencedColumns: [
              "id",
              "agency_organisation_id",
              "agency_worker_id",
              "profile_id",
            ]
          },
        ]
      }
      timesheet_facility_signoffs: {
        Row: {
          agency_facility_id: string
          agency_organisation_id: string
          decided_at: string
          decided_by_membership_id: string
          decision: Database["public"]["Enums"]["timesheet_facility_state"]
          dispute_reason:
            | Database["public"]["Enums"]["timesheet_dispute_reason"]
            | null
          entry_id: string
          facility_organisation_id: string
          id: string
          note: string | null
          relationship_id: string
          resolution:
            | Database["public"]["Enums"]["timesheet_dispute_resolution"]
            | null
          resolution_note: string | null
          resolved_at: string | null
          resolved_by_membership_id: string | null
          revision: number
          snapshot: Json
          superseded_at: string | null
          timesheet_id: string
        }
        Insert: {
          agency_facility_id: string
          agency_organisation_id: string
          decided_at?: string
          decided_by_membership_id: string
          decision: Database["public"]["Enums"]["timesheet_facility_state"]
          dispute_reason?:
            | Database["public"]["Enums"]["timesheet_dispute_reason"]
            | null
          entry_id: string
          facility_organisation_id: string
          id?: string
          note?: string | null
          relationship_id: string
          resolution?:
            | Database["public"]["Enums"]["timesheet_dispute_resolution"]
            | null
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by_membership_id?: string | null
          revision: number
          snapshot: Json
          superseded_at?: string | null
          timesheet_id: string
        }
        Update: {
          agency_facility_id?: string
          agency_organisation_id?: string
          decided_at?: string
          decided_by_membership_id?: string
          decision?: Database["public"]["Enums"]["timesheet_facility_state"]
          dispute_reason?:
            | Database["public"]["Enums"]["timesheet_dispute_reason"]
            | null
          entry_id?: string
          facility_organisation_id?: string
          id?: string
          note?: string | null
          relationship_id?: string
          resolution?:
            | Database["public"]["Enums"]["timesheet_dispute_resolution"]
            | null
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by_membership_id?: string | null
          revision?: number
          snapshot?: Json
          superseded_at?: string | null
          timesheet_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "timesheet_facility_signoffs_agency_facility_id_facility_or_fkey"
            columns: ["agency_facility_id", "facility_organisation_id"]
            isOneToOne: false
            referencedRelation: "agency_facilities"
            referencedColumns: ["id", "linked_facility_organisation_id"]
          },
          {
            foreignKeyName: "timesheet_facility_signoffs_decided_by_membership_id_facil_fkey"
            columns: ["decided_by_membership_id", "facility_organisation_id"]
            isOneToOne: false
            referencedRelation: "organisation_memberships"
            referencedColumns: ["id", "organisation_id"]
          },
          {
            foreignKeyName: "timesheet_facility_signoffs_entry_id_timesheet_id_relation_fkey"
            columns: [
              "entry_id",
              "timesheet_id",
              "relationship_id",
              "agency_facility_id",
              "facility_organisation_id",
            ]
            isOneToOne: false
            referencedRelation: "timesheet_entries"
            referencedColumns: [
              "id",
              "timesheet_id",
              "relationship_id",
              "agency_facility_id",
              "facility_organisation_id",
            ]
          },
          {
            foreignKeyName: "timesheet_facility_signoffs_relationship_id_agency_organis_fkey"
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
          {
            foreignKeyName: "timesheet_facility_signoffs_resolved_by_membership_id_agen_fkey"
            columns: ["resolved_by_membership_id", "agency_organisation_id"]
            isOneToOne: false
            referencedRelation: "organisation_memberships"
            referencedColumns: ["id", "organisation_id"]
          },
          {
            foreignKeyName: "timesheet_facility_signoffs_timesheet_id_agency_organisati_fkey"
            columns: ["timesheet_id", "agency_organisation_id"]
            isOneToOne: false
            referencedRelation: "timesheets"
            referencedColumns: ["id", "agency_organisation_id"]
          },
        ]
      }
      timesheet_history: {
        Row: {
          action: Database["public"]["Enums"]["timesheet_history_action"]
          actor_organisation_id: string | null
          actor_profile_id: string | null
          agency_organisation_id: string
          entry_id: string | null
          id: string
          note: string | null
          occurred_at: string
          reason_code: string | null
          revision: number
          sequence: number
          timesheet_id: string
        }
        Insert: {
          action: Database["public"]["Enums"]["timesheet_history_action"]
          actor_organisation_id?: string | null
          actor_profile_id?: string | null
          agency_organisation_id: string
          entry_id?: string | null
          id?: string
          note?: string | null
          occurred_at?: string
          reason_code?: string | null
          revision: number
          sequence?: never
          timesheet_id: string
        }
        Update: {
          action?: Database["public"]["Enums"]["timesheet_history_action"]
          actor_organisation_id?: string | null
          actor_profile_id?: string | null
          agency_organisation_id?: string
          entry_id?: string | null
          id?: string
          note?: string | null
          occurred_at?: string
          reason_code?: string | null
          revision?: number
          sequence?: never
          timesheet_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "timesheet_history_actor_organisation_id_fkey"
            columns: ["actor_organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timesheet_history_actor_profile_id_fkey"
            columns: ["actor_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timesheet_history_entry_id_timesheet_id_fkey"
            columns: ["entry_id", "timesheet_id"]
            isOneToOne: false
            referencedRelation: "timesheet_entries"
            referencedColumns: ["id", "timesheet_id"]
          },
          {
            foreignKeyName: "timesheet_history_timesheet_id_agency_organisation_id_fkey"
            columns: ["timesheet_id", "agency_organisation_id"]
            isOneToOne: false
            referencedRelation: "timesheets"
            referencedColumns: ["id", "agency_organisation_id"]
          },
        ]
      }
      timesheets: {
        Row: {
          agency_approved_at: string | null
          agency_approved_by_membership_id: string | null
          agency_organisation_id: string
          agency_worker_id: string
          created_at: string
          id: string
          locked_at: string | null
          period_end: string
          period_start: string
          profile_id: string
          rejected_at: string | null
          rejection_reason:
            | Database["public"]["Enums"]["timesheet_rejection_reason"]
            | null
          revision: number
          status: Database["public"]["Enums"]["timesheet_status"]
          submitted_at: string | null
          submitted_by_profile_id: string | null
          updated_at: string
        }
        Insert: {
          agency_approved_at?: string | null
          agency_approved_by_membership_id?: string | null
          agency_organisation_id: string
          agency_worker_id: string
          created_at?: string
          id?: string
          locked_at?: string | null
          period_end: string
          period_start: string
          profile_id: string
          rejected_at?: string | null
          rejection_reason?:
            | Database["public"]["Enums"]["timesheet_rejection_reason"]
            | null
          revision?: number
          status?: Database["public"]["Enums"]["timesheet_status"]
          submitted_at?: string | null
          submitted_by_profile_id?: string | null
          updated_at?: string
        }
        Update: {
          agency_approved_at?: string | null
          agency_approved_by_membership_id?: string | null
          agency_organisation_id?: string
          agency_worker_id?: string
          created_at?: string
          id?: string
          locked_at?: string | null
          period_end?: string
          period_start?: string
          profile_id?: string
          rejected_at?: string | null
          rejection_reason?:
            | Database["public"]["Enums"]["timesheet_rejection_reason"]
            | null
          revision?: number
          status?: Database["public"]["Enums"]["timesheet_status"]
          submitted_at?: string | null
          submitted_by_profile_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "timesheets_agency_approved_by_membership_id_agency_organis_fkey"
            columns: [
              "agency_approved_by_membership_id",
              "agency_organisation_id",
            ]
            isOneToOne: false
            referencedRelation: "organisation_memberships"
            referencedColumns: ["id", "organisation_id"]
          },
          {
            foreignKeyName: "timesheets_agency_worker_id_agency_organisation_id_profile_fkey"
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
            foreignKeyName: "timesheets_submitted_by_profile_id_fkey"
            columns: ["submitted_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
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
      activate_rate_version: {
        Args: { p_version_id: string }
        Returns: undefined
      }
      add_agency_worker_note: {
        Args: { p_body: string; p_worker_id: string }
        Returns: string
      }
      add_shift_internal_note: {
        Args: { p_body: string; p_shift_id: string }
        Returns: string
      }
      adjust_attendance_time: {
        Args: {
          p_adjustment_reason: Database["public"]["Enums"]["attendance_adjustment_reason"]
          p_attendance_id: string
          p_confirm_revision?: boolean
          p_event_type: Database["public"]["Enums"]["attendance_event_type"]
          p_note?: string
          p_segment?: number
          p_time: string
        }
        Returns: string
      }
      approve_invoice_draft: {
        Args: { p_draft_id: string }
        Returns: undefined
      }
      approve_payroll_batch: {
        Args: { p_batch_id: string }
        Returns: undefined
      }
      approve_timesheet: {
        Args: { p_expected_revision: number; p_timesheet_id: string }
        Returns: {
          blocking_reasons: string[]
          outcome: string
        }[]
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
      cancel_payroll_batch: {
        Args: { p_batch_id: string; p_reason: string }
        Returns: undefined
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
      clock_in_assignment: {
        Args: {
          p_accuracy_meters?: number
          p_assignment_id: string
          p_device_captured_at?: string
          p_latitude?: number
          p_longitude?: number
        }
        Returns: {
          attendance_id: string
          exception_codes: string[]
          geofence_result: Database["public"]["Enums"]["geofence_result"]
          outcome: string
          recorded_at: string
          refusal_code: string
          timezone: string
        }[]
      }
      clock_out_assignment: {
        Args: {
          p_accuracy_meters?: number
          p_assignment_id: string
          p_device_captured_at?: string
          p_latitude?: number
          p_longitude?: number
        }
        Returns: {
          attendance_id: string
          exception_codes: string[]
          geofence_result: Database["public"]["Enums"]["geofence_result"]
          outcome: string
          recorded_at: string
          timezone: string
        }[]
      }
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
          p_effective_from: string
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
      create_invoice_draft: {
        Args: {
          p_currency: string
          p_organisation_id: string
          p_period_start: string
          p_relationship_id: string
        }
        Returns: string
      }
      create_invoice_export: {
        Args: { p_draft_id: string; p_format: string }
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
      create_overtime_policy: {
        Args: {
          p_effective_from: string
          p_mode: Database["public"]["Enums"]["overtime_mode"]
          p_multiplier_denominator?: number
          p_multiplier_numerator?: number
          p_organisation_id: string
          p_side: Database["public"]["Enums"]["pricing_side"]
          p_weekly_threshold_minutes?: number
        }
        Returns: string
      }
      create_payroll_batch: {
        Args: {
          p_currency: string
          p_organisation_id: string
          p_period_start: string
        }
        Returns: string
      }
      create_payroll_export: { Args: { p_batch_id: string }; Returns: string }
      create_rate_card: {
        Args: {
          p_classification?: Database["public"]["Enums"]["shift_classification"]
          p_discipline_key: string
          p_organisation_id: string
          p_relationship_id?: string
        }
        Returns: string
      }
      create_rate_version: {
        Args: {
          p_bill_rate_minor: number
          p_currency: string
          p_effective_from: string
          p_effective_to?: string
          p_pay_rate_minor: number
          p_rate_card_id: string
        }
        Returns: string
      }
      create_rounding_policy: {
        Args: {
          p_effective_from: string
          p_increment_minutes?: number
          p_mode: Database["public"]["Enums"]["rounding_mode"]
          p_organisation_id: string
        }
        Returns: string
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
      discard_rate_version: {
        Args: { p_version_id: string }
        Returns: undefined
      }
      download_financial_export: {
        Args: { p_export_id: string }
        Returns: {
          byte_size: number
          content_base64: string
          content_type: string
          file_name: string
          sha256: string
        }[]
      }
      end_break_assignment: {
        Args: { p_assignment_id: string }
        Returns: {
          attendance_id: string
          recorded_at: string
          segment: number
        }[]
      }
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
      facility_decide_timesheet_entry: {
        Args: {
          p_dispute_reason?: Database["public"]["Enums"]["timesheet_dispute_reason"]
          p_entry_id: string
          p_expected_revision: number
          p_note?: string
          p_sign_off: boolean
        }
        Returns: Database["public"]["Enums"]["timesheet_status"]
      }
      financial_reconciliation: {
        Args: { p_organisation_id: string; p_side: string }
        Returns: {
          amount_minor: number
          currency: string
          line_count: number
          minutes: number
          state: string
        }[]
      }
      get_agency_financial_settings: {
        Args: { p_organisation_id: string }
        Returns: {
          configured: boolean
          invoice_reference_prefix: string
          payroll_anchor_date: string
          payroll_period_type: Database["public"]["Enums"]["payroll_period_type"]
          payroll_reference_prefix: string
          payroll_week_starts_on: number
        }[]
      }
      get_invoice_draft: {
        Args: { p_draft_id: string }
        Returns: {
          agency_facility_id: string
          agency_organisation_id: string
          approved_at: string
          approved_by_name: string
          attention: string
          created_at: string
          created_by_name: string
          currency: string
          exported_at: string
          facility_name: string
          invoice_draft_id: string
          line_count: number
          locked_at: string
          locked_by_name: string
          period_end: string
          period_start: string
          reference: string
          relationship_id: string
          reviewed_at: string
          reviewed_by_name: string
          status: Database["public"]["Enums"]["invoice_draft_status"]
          total_bill_minor: number
          total_priced_minutes: number
          void_reason: string
          voided_at: string
          voided_by_name: string
        }[]
      }
      get_payroll_batch: {
        Args: { p_batch_id: string }
        Returns: {
          agency_organisation_id: string
          approved_at: string
          approved_by_name: string
          attention: string
          cancel_reason: string
          cancelled_at: string
          cancelled_by_name: string
          created_at: string
          created_by_name: string
          currency: string
          exported_at: string
          line_count: number
          locked_at: string
          locked_by_name: string
          payroll_batch_id: string
          period_end: string
          period_start: string
          period_type: Database["public"]["Enums"]["payroll_period_type"]
          reference: string
          reviewed_at: string
          reviewed_by_name: string
          status: Database["public"]["Enums"]["payroll_batch_status"]
          total_overtime_minutes: number
          total_pay_minor: number
          total_regular_minutes: number
          worker_count: number
        }[]
      }
      get_priced_timesheet: {
        Args: { p_priced_timesheet_id: string }
        Returns: {
          agency_organisation_id: string
          calculation_version: number
          currency: string
          current_revision: number
          line_count: number
          period_end: string
          period_start: string
          priced_at: string
          priced_by_name: string
          priced_timesheet_id: string
          timesheet_id: string
          timesheet_revision: number
          total_bill_minor: number
          total_bill_overtime_minutes: number
          total_pay_minor: number
          total_pay_overtime_minutes: number
          total_priced_minutes: number
          total_raw_minutes: number
          worker_name: string
        }[]
      }
      get_timesheet: {
        Args: { p_timesheet_id: string }
        Returns: {
          agency_approved_at: string
          agency_organisation_id: string
          approval_blocking_reasons: string[]
          approved_by_name: string
          entry_count: number
          locked_at: string
          period_end: string
          period_start: string
          rejection_reason: Database["public"]["Enums"]["timesheet_rejection_reason"]
          return_note: string
          revision: number
          status: Database["public"]["Enums"]["timesheet_status"]
          submit_blocking_reasons: string[]
          submitted_at: string
          timesheet_id: string
          total_break_minutes: number
          total_worked_minutes: number
          viewer_is_worker: boolean
          worker_name: string
        }[]
      }
      list_agency_attendance: {
        Args: {
          p_from?: string
          p_organisation_id: string
          p_shift_id?: string
          p_to?: string
        }
        Returns: {
          assignment_id: string
          assignment_status: Database["public"]["Enums"]["assignment_status"]
          attendance_id: string
          clock_in_at: string
          clock_in_location: Database["public"]["Enums"]["geofence_result"]
          clock_out_at: string
          clock_out_location: Database["public"]["Enums"]["geofence_result"]
          clock_state: Database["public"]["Enums"]["attendance_clock_state"]
          end_at: string
          facility_name: string
          location_name: string
          needs_review: boolean
          open_exception_types: string[]
          pending_corrections: number
          shift_id: string
          start_at: string
          timezone: string
          worker_name: string
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
      list_agency_timesheets: {
        Args: {
          p_organisation_id: string
          p_period_start?: string
          p_status?: Database["public"]["Enums"]["timesheet_status"]
        }
        Returns: {
          disputed_count: number
          entry_count: number
          facilities: string[]
          issue_count: number
          pending_facility_count: number
          period_end: string
          period_start: string
          revision: number
          status: Database["public"]["Enums"]["timesheet_status"]
          submitted_at: string
          timesheet_id: string
          total_worked_minutes: number
          worker_name: string
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
      list_attendance_history: {
        Args: { p_attendance_id: string }
        Returns: {
          at: string
          detail: Json
          event_type: string
          item_id: string
          item_kind: string
          segment: number
        }[]
      }
      list_attendance_location_evidence: {
        Args: { p_attendance_id: string }
        Returns: {
          accuracy_meters: number
          device_captured_at: string
          distance_meters: number
          event_type: Database["public"]["Enums"]["attendance_event_type"]
          latitude: number
          longitude: number
          purged_at: string
          radius_meters: number
          recorded_at: string
          result: Database["public"]["Enums"]["geofence_result"]
          retention_days: number
          state: Database["public"]["Enums"]["location_evidence_state"]
        }[]
      }
      list_billable_work: {
        Args: { p_organisation_id: string }
        Returns: {
          adjustment_required: boolean
          agency_facility_id: string
          currency: string
          facility_name: string
          line_count: number
          period_end: string
          period_start: string
          relationship_id: string
          relationship_status: string
          total_bill_minor: number
          total_priced_minutes: number
          worker_count: number
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
      list_facility_shift_attendance: {
        Args: { p_shift_id: string }
        Returns: {
          assignment_id: string
          clock_in_at: string
          clock_in_location: Database["public"]["Enums"]["geofence_result"]
          clock_out_at: string
          clock_out_location: Database["public"]["Enums"]["geofence_result"]
          clock_state: Database["public"]["Enums"]["attendance_clock_state"]
          has_open_exception: boolean
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
      list_facility_timesheet_entries: {
        Args: { p_facility_organisation_id: string }
        Returns: {
          agency_name: string
          break_minutes: number
          breaks: Json
          decided_at: string
          dispute_reason: Database["public"]["Enums"]["timesheet_dispute_reason"]
          effective_end_at: string
          effective_start_at: string
          entry_id: string
          facility_name: string
          facility_state: Database["public"]["Enums"]["timesheet_facility_state"]
          had_attendance_exception: boolean
          local_date: string
          location_name: string
          scheduled_end_at: string
          scheduled_start_at: string
          timesheet_revision: number
          timezone: string
          worked_minutes: number
          worker_display_name: string
        }[]
      }
      list_financial_exports: {
        Args: { p_source_id: string; p_source_type: string }
        Returns: {
          byte_size: number
          currency: string
          export_number: number
          export_version: number
          file_name: string
          file_ref: string
          financial_export_id: string
          format: string
          generated_at: string
          generated_by_name: string
          row_count: number
          sha256: string
          source_attention: string
          source_reference: string
          source_status_at_export: string
          source_status_now: string
          total_minor: number
        }[]
      }
      list_invoice_draft_history: {
        Args: { p_draft_id: string }
        Returns: {
          action: string
          actor_name: string
          from_status: Database["public"]["Enums"]["invoice_draft_status"]
          note: string
          occurred_at: string
          to_status: Database["public"]["Enums"]["invoice_draft_status"]
        }[]
      }
      list_invoice_draft_lines: {
        Args: { p_draft_id: string }
        Returns: {
          bill_amount_minor: number
          bill_overtime_minutes: number
          bill_rate_minor: number
          bill_regular_minutes: number
          current_revision: number
          discipline_name: string
          line_number: number
          priced_minutes: number
          superseded: boolean
          timesheet_id: string
          timesheet_revision: number
          work_date: string
          worker_name: string
          worker_reference: string
        }[]
      }
      list_invoice_drafts: {
        Args: {
          p_organisation_id: string
          p_status?: Database["public"]["Enums"]["invoice_draft_status"]
        }
        Returns: {
          attention: string
          created_at: string
          created_by_name: string
          currency: string
          export_count: number
          facility_name: string
          invoice_draft_id: string
          line_count: number
          period_end: string
          period_start: string
          reference: string
          relationship_id: string
          status: Database["public"]["Enums"]["invoice_draft_status"]
          total_bill_minor: number
          total_priced_minutes: number
        }[]
      }
      list_invoice_issues: {
        Args: { p_organisation_id: string }
        Returns: {
          current_revision: number
          document_references: string[]
          facility_name: string
          invoice_draft_id: string
          issue_code: string
          new_revision_priced: boolean
          period_end: string
          period_start: string
          prepared_revision: number
          timesheet_id: string
          worker_name: string
        }[]
      }
      list_location_evidence_holds: {
        Args: { p_attendance_id: string }
        Returns: {
          hold_id: string
          placed_at: string
          placed_by_name: string
          reason: string
          released_at: string
        }[]
      }
      list_my_attendance: {
        Args: { p_organisation_id: string }
        Returns: {
          assignment_id: string
          attendance_id: string
          break_minutes: number
          can_clock_in: boolean
          can_clock_out: boolean
          can_end_break: boolean
          can_start_break: boolean
          clock_in_at: string
          clock_out_at: string
          clock_state: Database["public"]["Enums"]["attendance_clock_state"]
          corrections: Json
          earliest_clock_in_at: string
          end_at: string
          exceptions: Json
          facility_name: string
          location_name: string
          location_required: boolean
          shift_id: string
          shift_status: Database["public"]["Enums"]["shift_status"]
          start_at: string
          timezone: string
          worked_minutes: number
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
      list_my_timesheets: {
        Args: { p_organisation_id: string }
        Returns: {
          blocking_reasons: string[]
          can_submit: boolean
          entry_count: number
          incomplete_count: number
          period_end: string
          period_start: string
          revision: number
          status: Database["public"]["Enums"]["timesheet_status"]
          timesheet_id: string
          total_worked_minutes: number
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
      list_payroll_batch_history: {
        Args: { p_batch_id: string }
        Returns: {
          action: string
          actor_name: string
          from_status: Database["public"]["Enums"]["payroll_batch_status"]
          note: string
          occurred_at: string
          to_status: Database["public"]["Enums"]["payroll_batch_status"]
        }[]
      }
      list_payroll_batch_lines: {
        Args: { p_batch_id: string }
        Returns: {
          agency_worker_id: string
          calculation_version: number
          current_revision: number
          discipline_name: string
          facility_name: string
          line_number: number
          overtime_minutes: number
          pay_amount_minor: number
          pay_rate_minor: number
          priced_timesheet_id: string
          regular_minutes: number
          superseded: boolean
          timesheet_id: string
          timesheet_revision: number
          work_date: string
          worker_name: string
          worker_reference: string
        }[]
      }
      list_payroll_batch_workers: {
        Args: { p_batch_id: string }
        Returns: {
          agency_worker_id: string
          line_count: number
          overtime_minutes: number
          regular_minutes: number
          total_pay_minor: number
          worker_name: string
          worker_reference: string
        }[]
      }
      list_payroll_batches: {
        Args: {
          p_organisation_id: string
          p_status?: Database["public"]["Enums"]["payroll_batch_status"]
        }
        Returns: {
          attention: string
          created_at: string
          created_by_name: string
          currency: string
          export_count: number
          line_count: number
          payroll_batch_id: string
          period_end: string
          period_start: string
          reference: string
          status: Database["public"]["Enums"]["payroll_batch_status"]
          total_pay_minor: number
          worker_count: number
        }[]
      }
      list_payroll_issues: {
        Args: { p_organisation_id: string }
        Returns: {
          current_revision: number
          document_references: string[]
          issue_code: string
          new_revision_priced: boolean
          payroll_batch_id: string
          period_end: string
          period_start: string
          prepared_revision: number
          timesheet_id: string
          worker_name: string
        }[]
      }
      list_payroll_work: {
        Args: { p_organisation_id: string }
        Returns: {
          adjustment_required: boolean
          currency: string
          line_count: number
          period_end: string
          period_start: string
          timesheet_count: number
          total_overtime_minutes: number
          total_pay_minor: number
          total_regular_minutes: number
          worker_count: number
        }[]
      }
      list_priced_timesheet_lines: {
        Args: { p_priced_timesheet_id: string }
        Returns: {
          bill_amount_minor: number
          bill_overtime_denominator: number
          bill_overtime_minutes: number
          bill_overtime_numerator: number
          bill_rate_minor: number
          bill_regular_minutes: number
          classification: Database["public"]["Enums"]["shift_classification"]
          currency: string
          discipline_name: string
          entry_id: string
          facility_name: string
          line_number: number
          local_date: string
          pay_amount_minor: number
          pay_overtime_denominator: number
          pay_overtime_minutes: number
          pay_overtime_numerator: number
          pay_rate_minor: number
          pay_regular_minutes: number
          priced_minutes: number
          rate_precedence: number
          rate_version: number
          rate_version_id: string
          raw_minutes: number
          rounding_increment_minutes: number
          rounding_mode: Database["public"]["Enums"]["rounding_mode"]
          shift_id: string
        }[]
      }
      list_pricing_queue: {
        Args: {
          p_after_id?: string
          p_after_period?: string
          p_limit?: number
          p_organisation_id: string
          p_state: string
        }
        Returns: {
          currency: string
          current_revision: number
          entry_count: number
          facilities: string[]
          issues: Json
          period_end: string
          period_start: string
          priced_at: string
          priced_timesheet_id: string
          revision: number
          state: string
          timesheet_id: string
          total_bill_minor: number
          total_pay_minor: number
          worked_minutes: number
          worker_name: string
        }[]
      }
      list_rate_cards: {
        Args: {
          p_after_created_at?: string
          p_after_id?: string
          p_limit?: number
          p_organisation_id: string
        }
        Returns: {
          classification: Database["public"]["Enums"]["shift_classification"]
          created_at: string
          discipline_key: string
          discipline_name: string
          facility_name: string
          rate_card_id: string
          relationship_id: string
          versions: Json
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
      list_timesheet_entries: {
        Args: { p_timesheet_id: string }
        Returns: {
          approved_corrections: number
          assignment_id: string
          attendance_id: string
          blocking_reasons: string[]
          break_minutes: number
          breaks: Json
          clock_in_location: Database["public"]["Enums"]["geofence_result"]
          clock_out_location: Database["public"]["Enums"]["geofence_result"]
          complete: boolean
          effective_end_at: string
          effective_start_at: string
          entry_id: string
          facility_name: string
          facility_state: Database["public"]["Enums"]["timesheet_facility_state"]
          included: boolean
          local_date: string
          location_name: string
          not_worked: boolean
          open_exception_types: string[]
          pending_corrections: number
          scheduled_end_at: string
          scheduled_start_at: string
          shift_id: string
          timezone: string
          worked_minutes: number
        }[]
      }
      list_timesheet_history: {
        Args: { p_timesheet_id: string }
        Returns: {
          action: Database["public"]["Enums"]["timesheet_history_action"]
          actor_name: string
          actor_side: string
          entry_id: string
          note: string
          occurred_at: string
          reason_code: string
          revision: number
        }[]
      }
      lock_invoice_draft: { Args: { p_draft_id: string }; Returns: undefined }
      lock_payroll_batch: { Args: { p_batch_id: string }; Returns: undefined }
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
      place_location_evidence_hold: {
        Args: { p_attendance_id: string; p_reason: string }
        Returns: string
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
      price_timesheet: {
        Args: { p_expected_revision: number; p_timesheet_id: string }
        Returns: {
          issues: Json
          outcome: string
          priced_timesheet_id: string
        }[]
      }
      rebuild_timesheet: {
        Args: { p_timesheet_id: string }
        Returns: undefined
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
      reject_timesheet: {
        Args: {
          p_note?: string
          p_reason: Database["public"]["Enums"]["timesheet_rejection_reason"]
          p_timesheet_id: string
        }
        Returns: undefined
      }
      release_location_evidence_hold: {
        Args: { p_hold_id: string }
        Returns: undefined
      }
      reopen_timesheet: {
        Args: {
          p_note?: string
          p_reason: Database["public"]["Enums"]["timesheet_reopen_reason"]
          p_timesheet_id: string
        }
        Returns: undefined
      }
      request_attendance_correction: {
        Args: {
          p_assignment_id: string
          p_event_type: Database["public"]["Enums"]["attendance_event_type"]
          p_note?: string
          p_reason: Database["public"]["Enums"]["attendance_correction_reason"]
          p_requested_time: string
          p_segment?: number
        }
        Returns: string
      }
      resend_organisation_invite: {
        Args: { p_invite_id: string }
        Returns: {
          invite_expires_at: string
          invite_id: string
          invite_token: string
        }[]
      }
      resolve_timesheet_dispute: {
        Args: { p_entry_id: string; p_note?: string }
        Returns: undefined
      }
      review_attendance_correction: {
        Args: {
          p_adjustment_reason?: Database["public"]["Enums"]["attendance_adjustment_reason"]
          p_approve: boolean
          p_approved_time?: string
          p_confirm_revision?: boolean
          p_correction_id: string
          p_note?: string
          p_resolution: Database["public"]["Enums"]["attendance_correction_resolution"]
        }
        Returns: undefined
      }
      review_attendance_exception: {
        Args: {
          p_exception_id: string
          p_resolution?: Database["public"]["Enums"]["attendance_exception_resolution"]
          p_status: Database["public"]["Enums"]["attendance_exception_status"]
        }
        Returns: undefined
      }
      review_invoice_draft: { Args: { p_draft_id: string }; Returns: undefined }
      review_payroll_batch: { Args: { p_batch_id: string }; Returns: undefined }
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
      set_agency_attendance_settings: {
        Args: {
          p_clock_out_cutoff_minutes: number
          p_early_clock_in_minutes: number
          p_early_clock_out_minutes: number
          p_late_clock_in_minutes: number
          p_late_clock_out_minutes: number
          p_missed_clock_in_minutes: number
          p_missed_clock_out_minutes: number
          p_organisation_id: string
        }
        Returns: undefined
      }
      set_agency_facility_status: {
        Args: {
          p_facility_id: string
          p_status: Database["public"]["Enums"]["facility_status"]
        }
        Returns: undefined
      }
      set_agency_financial_settings: {
        Args: {
          p_invoice_reference_prefix?: string
          p_organisation_id: string
          p_payroll_anchor_date: string
          p_payroll_period_type: Database["public"]["Enums"]["payroll_period_type"]
          p_payroll_reference_prefix?: string
        }
        Returns: undefined
      }
      set_agency_timesheet_settings: {
        Args: { p_organisation_id: string; p_week_starts_on: number }
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
      set_location_evidence_retention: {
        Args: { p_organisation_id: string; p_retention_days: number }
        Returns: undefined
      }
      set_location_geofence: {
        Args: {
          p_enabled: boolean
          p_facility_location_id: string
          p_latitude: number
          p_longitude: number
          p_max_accuracy_meters: number
          p_outside_policy: Database["public"]["Enums"]["geofence_outside_policy"]
          p_radius_meters: number
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
      set_pricing_policy_status: {
        Args: {
          p_policy_id: string
          p_status: Database["public"]["Enums"]["rate_version_status"]
        }
        Returns: undefined
      }
      set_shift_classification: {
        Args: {
          p_classification: Database["public"]["Enums"]["shift_classification"]
          p_shift_id: string
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
      start_break_assignment: {
        Args: { p_assignment_id: string }
        Returns: {
          attendance_id: string
          recorded_at: string
          segment: number
        }[]
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
      submit_timesheet: {
        Args: { p_timesheet_id: string }
        Returns: {
          blocking_reasons: string[]
          outcome: string
        }[]
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
          p_effective_until?: string
          p_expiry_warning_days: number
          p_minimum_validity_days: number
          p_must_be_verified: boolean
          p_requirement_id: string
          p_status: Database["public"]["Enums"]["requirement_status"]
        }
        Returns: undefined
      }
      update_rate_version_draft: {
        Args: {
          p_bill_rate_minor: number
          p_currency: string
          p_effective_from: string
          p_effective_to?: string
          p_pay_rate_minor: number
          p_version_id: string
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
      void_invoice_draft: {
        Args: { p_draft_id: string; p_reason: string }
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
      attendance_adjustment_reason:
        | "facility_reported_time"
        | "supervisor_observation"
        | "device_or_app_problem"
        | "worker_statement"
        | "break_not_recorded"
        | "other"
      attendance_clock_state:
        | "not_started"
        | "clocked_in"
        | "on_break"
        | "clocked_out"
      attendance_correction_origin: "worker_request" | "reviewer_adjustment"
      attendance_correction_reason:
        | "forgot_to_clock"
        | "device_or_app_problem"
        | "location_problem"
        | "recorded_wrong_time"
        | "other"
      attendance_correction_resolution:
        | "approved_as_requested"
        | "approved_with_adjustment"
        | "rejected_time_not_supported"
        | "rejected_duplicate"
        | "rejected_other"
      attendance_correction_status: "pending" | "approved" | "rejected"
      attendance_event_source: "worker_device" | "approved_correction"
      attendance_event_type:
        | "clock_in"
        | "clock_out"
        | "corrected_clock_in"
        | "corrected_clock_out"
        | "break_start"
        | "break_end"
        | "corrected_break_start"
        | "corrected_break_end"
      attendance_exception_resolution:
        | "acknowledged"
        | "correction_approved"
        | "correction_rejected"
        | "clocked_in"
        | "clocked_out"
        | "assignment_closed"
        | "not_applicable"
        | "not_worked"
      attendance_exception_source:
        | "clock_action"
        | "scheduled_scan"
        | "correction"
      attendance_exception_status:
        | "open"
        | "under_review"
        | "resolved"
        | "dismissed"
      attendance_exception_type:
        | "late_clock_in"
        | "early_clock_out"
        | "late_clock_out"
        | "missed_clock_in"
        | "missed_clock_out"
        | "outside_geofence"
        | "poor_location_accuracy"
        | "location_unavailable"
        | "assignment_not_ready"
        | "manual_correction_requested"
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
      geofence_outside_policy: "block" | "allow_with_review"
      geofence_result:
        | "not_required"
        | "inside"
        | "outside"
        | "low_accuracy"
        | "unavailable"
      invite_delivery_status: "not_attempted" | "sent" | "failed" | "skipped"
      invite_status: "pending" | "accepted" | "revoked"
      invoice_draft_status:
        | "draft"
        | "reviewed"
        | "approved"
        | "locked"
        | "exported"
        | "voided"
      jurisdiction_level: "country" | "subdivision"
      location_evidence_state: "retained" | "purged" | "on_hold"
      membership_status: "active" | "suspended" | "revoked"
      organisation_status: "active" | "suspended" | "archived"
      organisation_type: "agency" | "facility"
      overtime_mode: "none" | "weekly_threshold"
      payroll_batch_status:
        | "draft"
        | "reviewed"
        | "approved"
        | "locked"
        | "exported"
        | "cancelled"
      payroll_period_type: "weekly" | "biweekly"
      pricing_side: "pay" | "bill"
      profile_status: "active" | "suspended"
      rate_version_status: "draft" | "active" | "discarded"
      readiness_status: "ready" | "action_required" | "not_eligible"
      relationship_status: "pending" | "active" | "suspended" | "ended"
      requirement_status: "active" | "inactive"
      rounding_mode: "none" | "nearest"
      shift_cancellation_reason:
        | "facility_cancelled"
        | "staffing_no_longer_needed"
        | "entered_in_error"
        | "relationship_suspended"
        | "other"
        | "relationship_ended"
      shift_classification: "regular" | "evening" | "night" | "weekend"
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
      timesheet_dispute_reason:
        | "worker_not_present"
        | "time_incorrect"
        | "break_incorrect"
        | "assignment_not_worked"
        | "other"
      timesheet_dispute_resolution: "times_confirmed" | "timesheet_revised"
      timesheet_facility_state:
        | "not_required"
        | "pending"
        | "signed_off"
        | "disputed"
      timesheet_history_action:
        | "submitted"
        | "rejected"
        | "agency_approved"
        | "facility_signed_off"
        | "facility_disputed"
        | "dispute_resolved"
        | "locked"
        | "reopened"
        | "revised"
        | "facility_signoff_not_required"
      timesheet_rejection_reason:
        | "attendance_incorrect"
        | "missing_information"
        | "facility_discrepancy"
        | "other"
      timesheet_reopen_reason:
        | "facility_discrepancy"
        | "attendance_changed"
        | "approved_in_error"
        | "other"
      timesheet_status:
        | "open"
        | "submitted"
        | "rejected"
        | "agency_approved"
        | "locked"
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
      attendance_adjustment_reason: [
        "facility_reported_time",
        "supervisor_observation",
        "device_or_app_problem",
        "worker_statement",
        "break_not_recorded",
        "other",
      ],
      attendance_clock_state: [
        "not_started",
        "clocked_in",
        "on_break",
        "clocked_out",
      ],
      attendance_correction_origin: ["worker_request", "reviewer_adjustment"],
      attendance_correction_reason: [
        "forgot_to_clock",
        "device_or_app_problem",
        "location_problem",
        "recorded_wrong_time",
        "other",
      ],
      attendance_correction_resolution: [
        "approved_as_requested",
        "approved_with_adjustment",
        "rejected_time_not_supported",
        "rejected_duplicate",
        "rejected_other",
      ],
      attendance_correction_status: ["pending", "approved", "rejected"],
      attendance_event_source: ["worker_device", "approved_correction"],
      attendance_event_type: [
        "clock_in",
        "clock_out",
        "corrected_clock_in",
        "corrected_clock_out",
        "break_start",
        "break_end",
        "corrected_break_start",
        "corrected_break_end",
      ],
      attendance_exception_resolution: [
        "acknowledged",
        "correction_approved",
        "correction_rejected",
        "clocked_in",
        "clocked_out",
        "assignment_closed",
        "not_applicable",
        "not_worked",
      ],
      attendance_exception_source: [
        "clock_action",
        "scheduled_scan",
        "correction",
      ],
      attendance_exception_status: [
        "open",
        "under_review",
        "resolved",
        "dismissed",
      ],
      attendance_exception_type: [
        "late_clock_in",
        "early_clock_out",
        "late_clock_out",
        "missed_clock_in",
        "missed_clock_out",
        "outside_geofence",
        "poor_location_accuracy",
        "location_unavailable",
        "assignment_not_ready",
        "manual_correction_requested",
      ],
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
      geofence_outside_policy: ["block", "allow_with_review"],
      geofence_result: [
        "not_required",
        "inside",
        "outside",
        "low_accuracy",
        "unavailable",
      ],
      invite_delivery_status: ["not_attempted", "sent", "failed", "skipped"],
      invite_status: ["pending", "accepted", "revoked"],
      invoice_draft_status: [
        "draft",
        "reviewed",
        "approved",
        "locked",
        "exported",
        "voided",
      ],
      jurisdiction_level: ["country", "subdivision"],
      location_evidence_state: ["retained", "purged", "on_hold"],
      membership_status: ["active", "suspended", "revoked"],
      organisation_status: ["active", "suspended", "archived"],
      organisation_type: ["agency", "facility"],
      overtime_mode: ["none", "weekly_threshold"],
      payroll_batch_status: [
        "draft",
        "reviewed",
        "approved",
        "locked",
        "exported",
        "cancelled",
      ],
      payroll_period_type: ["weekly", "biweekly"],
      pricing_side: ["pay", "bill"],
      profile_status: ["active", "suspended"],
      rate_version_status: ["draft", "active", "discarded"],
      readiness_status: ["ready", "action_required", "not_eligible"],
      relationship_status: ["pending", "active", "suspended", "ended"],
      requirement_status: ["active", "inactive"],
      rounding_mode: ["none", "nearest"],
      shift_cancellation_reason: [
        "facility_cancelled",
        "staffing_no_longer_needed",
        "entered_in_error",
        "relationship_suspended",
        "other",
        "relationship_ended",
      ],
      shift_classification: ["regular", "evening", "night", "weekend"],
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
      timesheet_dispute_reason: [
        "worker_not_present",
        "time_incorrect",
        "break_incorrect",
        "assignment_not_worked",
        "other",
      ],
      timesheet_dispute_resolution: ["times_confirmed", "timesheet_revised"],
      timesheet_facility_state: [
        "not_required",
        "pending",
        "signed_off",
        "disputed",
      ],
      timesheet_history_action: [
        "submitted",
        "rejected",
        "agency_approved",
        "facility_signed_off",
        "facility_disputed",
        "dispute_resolved",
        "locked",
        "reopened",
        "revised",
        "facility_signoff_not_required",
      ],
      timesheet_rejection_reason: [
        "attendance_incorrect",
        "missing_information",
        "facility_discrepancy",
        "other",
      ],
      timesheet_reopen_reason: [
        "facility_discrepancy",
        "attendance_changed",
        "approved_in_error",
        "other",
      ],
      timesheet_status: [
        "open",
        "submitted",
        "rejected",
        "agency_approved",
        "locked",
      ],
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
