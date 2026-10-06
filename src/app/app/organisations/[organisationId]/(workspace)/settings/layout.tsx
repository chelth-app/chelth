import { PageHeader } from "@/components/ui/page-header";
import { loadOrganisationPage } from "@/features/organisations";

import { SettingsNav } from "./_components/settings-nav";
import { settingsHref, visibleSections } from "./_components/settings-sections";

/**
 * Settings (P0-E8-S9H, locked Settings reference): the canonical page header,
 * a secondary section navigation and the section work area. Administration
 * width: the work area is left-aligned beside the section nav and capped for
 * readable forms — not a centred website column. Each section page applies
 * its own capability gate.
 */
export default async function SettingsLayout({
  children,
  params,
}: LayoutProps<"/app/organisations/[organisationId]/settings">) {
  const context = await loadOrganisationPage((await params).organisationId);
  const { organisationId, organisation, can } = context;
  const sections = visibleSections(organisation.type, can);

  return (
    <div className="chelth-locked flex flex-col gap-[13px]">
      <PageHeader
        variant="reference"
        className="xl:mb-1"
        title="Settings"
        description={
          <p>
            {organisation.type === "agency"
              ? "Manage workspace access, workforce policies, attendance rules, payroll controls and security settings."
              : "Manage workspace access and security settings."}
          </p>
        }
      />
      <div className="grid gap-4 lg:grid-cols-[264px_minmax(0,1fr)] lg:items-start xl:gap-5">
        <SettingsNav
          items={sections.map((section) => ({
            label: section.label,
            href: settingsHref(organisationId, section),
            icon: section.icon,
            exact: section.segment === "",
          }))}
        />
        <div className="flex max-w-[1180px] min-w-0 flex-col gap-4">{children}</div>
      </div>
    </div>
  );
}
