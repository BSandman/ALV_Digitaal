// Store-interfaces (repository-patroon, ADR-0003). De rest van de app praat ALLEEN
// met deze interfaces, nooit met directe SQL. Zo raakt een engine-wissel of de latere
// integratie in het MariaDB-Platform maar één laag.
//
// JSDoc-typedefs beschrijven het contract; de MariaDB-implementatie zit in ./mariadb/.
// Codex vult de implementaties; Claude (Validator) toetst tegen ADR-0002 + acceptatiecriteria.

/**
 * @typedef {Object} Round
 * @property {number} id
 * @property {number} motionId
 * @property {number} roundVersion
 * @property {'waiting'|'open'|'closing'|'closed'} status
 * @property {string|null} openedAt   ISO UTC
 * @property {string|null} closedAt   ISO UTC
 */

/**
 * @typedef {Object} VoteChoice
 * @property {number} entitlementId
 * @property {'voor'|'tegen'|'blanco'|'onthouding'} choice
 */

/**
 * @typedef {Object} RoundResult
 * @property {number} roundId
 * @property {Object} snapshot   bevroren presentie/quorum/gewogen uitslag (onveranderlijk)
 */

/**
 * MeetingStore — vergadering, deelnemers, rechten, presentie.
 * @typedef {Object} MeetingStore
 * @property {(meetingId:number) => Promise<object|null>} getMeeting
 * @property {(meetingId:number) => Promise<object[]>} listParticipants
 * @property {(participantId:number) => Promise<object[]>} listEntitlements  rechten NIET samenvoegen
 * @property {(meetingId:number, participantId:number, present:boolean) => Promise<void>} setAttendance
 */

/**
 * VoteStore — stemrondes en het correctheidskritische sluiten.
 * @typedef {Object} VoteStore
 * @property {(motionId:number) => Promise<Round>} openRound
 * @property {(roundId:number, vote:VoteChoice) => Promise<{acceptedAt:string}>} recordVote
 *           append-only revisie; alleen na expliciete serverbevestiging telt een stem
 * @property {(roundId:number, entitlementId:number) => Promise<VoteChoice|null>} getCurrentVote
 * @property {(roundId:number) => Promise<RoundResult>} closeRoundAtomically
 *           bevries ronde, weiger latere stemmen, bereken uitslag — alles in één transactie
 */

export {}; // alleen typedefs; geen runtime-export
