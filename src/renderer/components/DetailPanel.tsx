import type { Project, VendorDictionary } from '../../core/types'
import { placeDetails, placeIdsForSelection } from '../placeDetails'
import { STRINGS } from '../strings'

/**
 * The right-hand bar: what the clicked point holds. It exists only while something is selected
 * (App renders nothing otherwise), and it says four things per service -- name, where it is,
 * what was observed running, how long it keeps things -- with "not yet identified" doing the
 * honest work for everything nobody has answered.
 */

interface Props {
  project: Project
  selected: string
  dictionary: VendorDictionary
}

export function DetailPanel({ project, selected, dictionary }: Props) {
  if (selected === 'centre') {
    if (project.subjectGroups.length === 0) return null
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

  if (places.length === 0) return null

  return (
    <aside className="detail">
      <h2 className="detail-head">{STRINGS.detailHeading}</h2>
      {places.map((d) => (
        <article key={d.id} className="detail-place">
          <h3 className="detail-place-name">{d.name}</h3>
          <dl className="detail-facts">
            <div>
              <dt>{STRINGS.detailPurpose}</dt>
              <dd>{d.purposeGroup}</dd>
            </div>
            <div>
              <dt>{STRINGS.detailWhere}</dt>
              <dd>{d.whereLabel}</dd>
            </div>
            <div>
              <dt>{STRINGS.detailRetention}</dt>
              <dd>{d.retentionLabel}</dd>
            </div>
            <div>
              <dt>{STRINGS.detailDataCategories}</dt>
              <dd>{d.dataCategoriesLabel}</dd>
            </div>
          </dl>
          {d.declaredIn.length === 0 ? null : (
            <p className="detail-declared">{STRINGS.declaredIn(d.declaredIn.join(', '))}</p>
          )}
          <h4 className="detail-sub">{STRINGS.detailObservationsHeading}</h4>
          {d.observations.length === 0 ? (
            <p className="detail-none">{STRINGS.notYetIdentified}</p>
          ) : (
            <ul className="detail-observations">
              {d.observations.map((o) => (
                <li key={o.domain}>{STRINGS.detailObservation(o.domain, o.requestCount, o.beforeConsent)}</li>
              ))}
            </ul>
          )}
        </article>
      ))}
    </aside>
  )
}
