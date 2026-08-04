import { useState } from 'react'
import type {
  Confidence,
  CookieLifetime,
  HandEnteredField,
  Project,
  VendorDictionary,
} from '../../core/types'
import type {
  ControllerPanel,
  DoorPanel,
  GroupPanel,
  PanelFact,
  PanelQuestion,
  PanelUnknowns,
  PlacePanel,
} from '../../core/panel'
import { panelFor } from '../../core/panel'
import { STRINGS } from '../strings'

/**
 * The side panel: the answer to a click, on screen beside the map rather than below the fold.
 *
 * Facts first. Only a field somebody answered appears, and under each one a small line saying how
 * it is known and from what -- a fact nobody sourced is still shown, marked as recorded by hand.
 * Everything nobody has answered is one line: "N things not yet identified", opening to the same
 * questions the printed gaps sheet asks. When nothing is unknown that line is absent, not zero.
 */

/** Answering a question the map asked: which place, which field, and what was said. */
export type AnswerHandler = (
  placeId: string,
  field: HandEnteredField,
  value: string | boolean,
) => void

interface Props {
  project: Project
  selected: string
  dictionary: VendorDictionary
  /** Absent in contexts that only display, such as a test rendering the panel on its own. */
  onAnswer?: AnswerHandler
}

const FIELD_LABEL: Readonly<Record<PanelFact['field'], string>> = {
  purpose: STRINGS.detailPurpose,
  where: STRINGS.detailWhere,
  retention: STRINGS.detailRetention,
  dataCategories: STRINGS.detailDataCategories,
  eea: STRINGS.detailEEA,
}

const CONFIDENCE_WORD: Readonly<Record<Confidence, string>> = {
  observed: STRINGS.detailConfidenceObserved,
  declared: STRINGS.detailConfidenceDeclared,
  inferred: STRINGS.detailConfidenceInferred,
}

const LIFETIME_WORD: Readonly<Record<CookieLifetime, string>> = {
  session: STRINGS.detailLifetimeSession,
  'under-a-day': STRINGS.detailLifetimeUnderADay,
  'under-a-year': STRINGS.detailLifetimeUnderAYear,
  'a-year-or-more': STRINGS.detailLifetimeAYearOrMore,
}

/** The EEA fact is stated here and only here -- the map retired the mark, not the fact. */
function factValue(fact: PanelFact): string {
  if (fact.field !== 'eea') return fact.value
  return fact.value === 'outside' ? STRINGS.detailEEAOutside : STRINGS.detailEEAInside
}

function Facts({ facts }: { facts: PanelFact[] }) {
  if (facts.length === 0) return null
  return (
    <dl className="detail-facts">
      {facts.map((f) => (
        <div key={f.field}>
          <dt>{FIELD_LABEL[f.field]}</dt>
          <dd>{factValue(f)}</dd>
          <dd className="detail-said-by">
            {f.byHand || f.sourceNames.length === 0
              ? STRINGS.detailRecordedByHand
              : STRINGS.detailAttribution(CONFIDENCE_WORD[f.confidence], f.sourceNames.join(', '))}
          </dd>
        </div>
      ))}
    </dl>
  )
}

function Attribution({ sourceNames, confidence }: { sourceNames: string[]; confidence: Confidence }) {
  return (
    <p className="detail-said-by">
      {sourceNames.length === 0
        ? STRINGS.detailRecordedByHand
        : STRINGS.detailAttribution(CONFIDENCE_WORD[confidence], sourceNames.join(', '))}
    </p>
  )
}

/**
 * One question, with the means to answer it when there is one. Two of the three gap rules map
 * onto a field of the place; the third asks which document says so, which no text box can
 * answer, so it is stated and left alone.
 */
function Question({
  question,
  placeId,
  onAnswer,
}: {
  question: PanelQuestion
  placeId: string | null
  onAnswer?: AnswerHandler
}) {
  const [typed, setTyped] = useState('')
  const answerable = question.answer !== undefined && placeId !== null && onAnswer !== undefined
  if (!answerable || question.answer === undefined || placeId === null || onAnswer === undefined) {
    return <li>{question.question}</li>
  }
  const { field, kind } = question.answer

  if (kind === 'yesno') {
    return (
      <li>
        {question.question}
        <span className="answer">
          <button className="answer-choice" onClick={() => onAnswer(placeId, field, true)}>
            {STRINGS.detailAnswerYes}
          </button>
          <button className="answer-choice" onClick={() => onAnswer(placeId, field, false)}>
            {STRINGS.detailAnswerNo}
          </button>
        </span>
      </li>
    )
  }

  return (
    <li>
      {question.question}
      <form
        className="answer"
        onSubmit={(e) => {
          e.preventDefault()
          if (typed.trim() === '') return
          onAnswer(placeId, field, typed)
          setTyped('')
        }}
      >
        <input
          className="answer-input"
          type="text"
          value={typed}
          placeholder={STRINGS.detailAnswerPlaceholder}
          onChange={(e) => setTyped(e.target.value)}
        />
        <button className="answer-choice" type="submit">
          {STRINGS.detailAnswerSave}
        </button>
      </form>
    </li>
  )
}

function Unknowns({
  unknowns,
  placeId = null,
  onAnswer,
}: {
  unknowns: PanelUnknowns
  placeId?: string | null
  onAnswer?: AnswerHandler
}) {
  if (unknowns.count === 0) return null
  return (
    <details className="detail-unknowns">
      <summary>{STRINGS.detailUnknownsSummary(unknowns.count)}</summary>
      <ul>
        {unknowns.questions.map((q) => (
          <Question key={q.id} question={q} placeId={placeId} onAnswer={onAnswer} />
        ))}
      </ul>
    </details>
  )
}

function PlaceView({ panel, onAnswer }: { panel: PlacePanel; onAnswer?: AnswerHandler }) {
  const unsourced = panel.facts.length > 0 && panel.facts.every((f) => f.sourceNames.length === 0)
  return (
    <>
      <h2 className="detail-head">{STRINGS.detailHeading}</h2>
      <article className="detail-place">
        <h3 className="detail-place-name">{panel.name}</h3>
        <Facts facts={panel.facts} />
        {unsourced ? (
          <Attribution sourceNames={[]} confidence={panel.facts[0]?.confidence ?? 'inferred'} />
        ) : null}
        {panel.observations.length === 0 ? null : (
          <>
            <h4 className="detail-sub">{STRINGS.detailObservationsHeading}</h4>
            <ul className="detail-observations">
              {panel.observations.map((o) => (
                <li key={o.domain}>
                  {STRINGS.detailObservation(o.domain, o.requestCount, o.beforeConsent)}
                </li>
              ))}
            </ul>
          </>
        )}
        {panel.cookies.length === 0 ? null : (
          <>
            <h4 className="detail-sub">{STRINGS.detailCookiesHeading}</h4>
            <ul className="detail-observations">
              {panel.cookies.map((c) => (
                <li key={c.name}>
                  {STRINGS.detailCookie(c.name, LIFETIME_WORD[c.lifetime], c.thirdParty)}
                </li>
              ))}
            </ul>
          </>
        )}
        {panel.reachedFrom.length === 0 ? null : (
          <p className="detail-reached">
            <span className="detail-reached-label">{STRINGS.detailReachedFrom}</span>
            {panel.reachedFrom.map((d) => (
              <span key={d.id} className={`chip chip--${d.colourIndex}`} aria-hidden="true" />
            ))}
          </p>
        )}
        <Unknowns unknowns={panel.unknowns} placeId={panel.id} onAnswer={onAnswer} />
      </article>
    </>
  )
}

function DoorView({ panel }: { panel: DoorPanel }) {
  return (
    <>
      <h2 className="detail-head">{STRINGS.detailDoorHeading}</h2>
      <article className="detail-place">
        <h3 className="detail-place-name">{panel.label}</h3>
        <p className="detail-said-by">
          {panel.origin === 'discovered' ? STRINGS.doorDiscovered : STRINGS.doorDeclared}
        </p>
        {panel.whoComesThrough.length === 0 ? null : (
          <>
            <h4 className="detail-sub">{STRINGS.detailDoorWhoComesThrough}</h4>
            <ul className="detail-observations">
              {panel.whoComesThrough.map((name) => (
                <li key={name}>{name}</li>
              ))}
            </ul>
          </>
        )}
        {panel.fields.length === 0 ? null : (
          <>
            <h4 className="detail-sub">{STRINGS.detailDoorFields}</h4>
            <ul className="detail-observations">
              {panel.fields.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </>
        )}
        <Unknowns unknowns={panel.unknowns} />
      </article>
    </>
  )
}

function ControllerView({ panel }: { panel: ControllerPanel }) {
  return (
    <>
      <h2 className="detail-head">{STRINGS.detailControllerHeading}</h2>
      <article className="detail-place">
        <h3 className="detail-place-name">
          {panel.name === null ? STRINGS.yourOrganisation : panel.name}
        </h3>
        {panel.name === null ? null : (
          <Attribution sourceNames={panel.sourceNames} confidence="declared" />
        )}
        <p className="detail-totals">
          {STRINGS.detailTotals(
            panel.totals.places,
            panel.totals.doors,
            panel.totals.subjectGroups,
            panel.totals.flows,
          )}
        </p>
        <Unknowns unknowns={panel.unknowns} />
      </article>
    </>
  )
}

function GroupView({ panel }: { panel: GroupPanel }) {
  return (
    <>
      <h2 className="detail-head">{STRINGS.detailHeading}</h2>
      <article className="detail-place">
        <h3 className="detail-place-name">{panel.name}</h3>
        <ul className="detail-observations">
          {panel.members.map((m) => (
            <li key={m.id} className={m.unexplained ? 'detail-member--open' : undefined}>
              {m.name}
            </li>
          ))}
        </ul>
      </article>
    </>
  )
}

export function DetailPanel({ project, selected, dictionary, onAnswer }: Props) {
  if (selected === 'centre') {
    // The v0.2 people hub. The redesign draws each subject group as its own node, so this only
    // answers a selection carried over from an older sheet.
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

  const subject = project.subjectGroups.find((s) => s.id === selected)
  if (subject !== undefined) {
    return (
      <aside className="detail">
        <h2 className="detail-head">{STRINGS.detailPeopleHeading}</h2>
        <article className="detail-place">
          <h3 className="detail-place-name">{subject.name}</h3>
          {subject.notes === undefined ? null : (
            <p className="detail-subject-notes">{subject.notes}</p>
          )}
        </article>
      </aside>
    )
  }

  const panel = panelFor(project, selected, dictionary)
  if (panel === null) return null

  return (
    <aside className="detail">
      {panel.sort === 'place' ? <PlaceView panel={panel} onAnswer={onAnswer} /> : null}
      {panel.sort === 'door' ? <DoorView panel={panel} /> : null}
      {panel.sort === 'controller' ? <ControllerView panel={panel} /> : null}
      {panel.sort === 'group' ? <GroupView panel={panel} /> : null}
    </aside>
  )
}
