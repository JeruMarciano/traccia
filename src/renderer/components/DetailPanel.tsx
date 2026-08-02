import type { Project, VendorDictionary } from '../../core/types'
import { placeDetails, placeIdsForSelection } from '../placeDetails'
import { STRINGS } from '../strings'

/**
 * The right-hand panel: the content of whatever is selected on the map.
 *
 * The map selects a purpose group, not a single place (see placeDetails.ts), so a group
 * selection lists every place inside it, each with what the project knows about it. The people
 * hub lists who the map is about. Nothing selected is a prompt, not an empty table.
 */

interface Props {
  project: Project
  selected: string | null
  dictionary: VendorDictionary
}

function Empty() {
  return (
    <aside className="detail">
      <h2 className="detail-head">{STRINGS.detailHeading}</h2>
      <p className="detail-empty">{STRINGS.detailEmpty}</p>
    </aside>
  )
}

export function DetailPanel({ project, selected, dictionary }: Props) {
  if (selected === null) return <Empty />

  if (selected === 'centre') {
    if (project.subjectGroups.length === 0) return <Empty />
    return (
      <aside className="detail">
        <h2 className="detail-head">{STRINGS.detailPeopleHeading}</h2>
        <ul className="detail-subjects">
          {project.subjectGroups.map((s) => (
            <li key={s.id}>
              <p className="detail-subject-name">{s.name}</p>
              {s.notes === undefined ? null : <p className="detail-subject-notes">{s.notes}</p>}
            </li>
          ))}
        </ul>
      </aside>
    )
  }

  const places = placeIdsForSelection(project, selected)
    .map((id) => placeDetails(project, id, dictionary))
    .filter((d): d is NonNullable<typeof d> => d !== null)

  if (places.length === 0) return <Empty />

  return (
    <aside className="detail">
      <h2 className="detail-head">{STRINGS.detailHeading}</h2>
      {places.map((d) => (
        <article key={d.id} className="detail-place">
          <h3 className="detail-place-name">{d.name}</h3>
          <p className="detail-purpose">{d.purposeGroup}</p>
          <dl className="detail-facts">
            <div>
              <dt>{STRINGS.detailHolder}</dt>
              <dd>{d.holderLabel}</dd>
            </div>
            <div>
              <dt>{STRINGS.detailKind}</dt>
              <dd>{d.kindLabel}</dd>
            </div>
            <div>
              <dt>{STRINGS.detailConfidence}</dt>
              <dd>{d.confidenceLabel}</dd>
            </div>
            <div>
              <dt>{STRINGS.detailJurisdiction}</dt>
              <dd>{d.jurisdictionLabel}</dd>
            </div>
            <div>
              <dt>{STRINGS.detailLeavesEEA}</dt>
              <dd>{d.leavesEEALabel}</dd>
            </div>
            <div>
              <dt>{STRINGS.detailRetention}</dt>
              <dd>{d.retentionLabel}</dd>
            </div>
          </dl>

          {d.flowsIn.length === 0 ? null : (
            <>
              <h4 className="detail-sub">{STRINGS.detailFlowsHeading}</h4>
              <ul className="detail-flows">
                {d.flowsIn.map((f) => (
                  <li key={f.id}>
                    <p className="detail-flow-data">{f.dataDescription}</p>
                    <p className="detail-flow-purpose">{STRINGS.detailFlowFrom(f.fromLabel, f.purpose)}</p>
                  </li>
                ))}
              </ul>
            </>
          )}

          {d.observations.length === 0 ? null : (
            <>
              <h4 className="detail-sub">{STRINGS.detailObservationsHeading}</h4>
              <ul className="detail-observations">
                {d.observations.map((o) => (
                  <li key={o.domain}>{STRINGS.detailObservation(o.domain, o.requestCount, o.beforeConsent)}</li>
                ))}
              </ul>
            </>
          )}
        </article>
      ))}
    </aside>
  )
}
