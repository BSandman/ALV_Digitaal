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
 * @property {number} remainingSeconds server-relatief; nooit een absolute client-deadline
 */

/**
 * @typedef {Object} VoteChoice
 * @property {number} entitlementId
 * @property {'voor'|'tegen'} choice  eigenaar-invoer; blanco/onthouding zijn geen in-app keuze (ADR-0011)
 */

/**
 * @typedef {Object} RoundResult
 * @property {number} roundId
 * @property {Object} snapshot   bevroren vergaderingquorum + gewogen ronde-uitslag
 */

/**
 * MeetingStore — vergadering, deelnemers, rechten, presentie.
 * @typedef {Object} MeetingStore
 * @property {(meetingId:number) => Promise<object|null>} getMeeting
 * @property {(meetingId:number) => Promise<object[]>} listParticipants
 * @property {(participantId:number) => Promise<object[]>} listEntitlements  rechten NIET samenvoegen
 * @property {(meetingId:number, participantId:number, present:boolean) => Promise<void>} setAttendance
 * @property {(meetingId:number, input:{setBy:string, quorumNumerator:number, quorumDenominator:number}) => Promise<object>} establishQuorum
 *           voorzittersactie; bevriest éénmalig de deelnemende set en quorumvlag
 */

/**
 * VoteStore — stemrondes en het correctheidskritische sluiten.
 * @typedef {Object} VoteStore
 * @property {(motionId:number, durationSeconds:number) => Promise<Round>} openRound
 *           vereist een reeds bevroren vergaderingquorum
 * @property {(roundId:number, participantId:number, vote:VoteChoice) => Promise<{acceptedAt:string}>} recordVote
 *           append-only revisie; alleen na expliciete serverbevestiging telt een stem
 * @property {(roundId:number, participantId:number, entitlementId:number) => Promise<VoteChoice|null>} getCurrentVote
 * @property {(roundId:number) => Promise<object|null>} getRoundStatus
 * @property {(roundId:number) => Promise<RoundResult>} closeRoundAtomically
 *           bevries ronde, registreer niet-stemmers als onthouding en bereken meerderheid — alles in één transactie
 */

export {}; // alleen typedefs; geen runtime-export
