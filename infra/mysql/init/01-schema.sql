-- Digitaal ALV-eigenaarportaal — beginschema (dev/test).
-- Gebaseerd op de minimale gegevensobjecten uit v0.1.0 §7.
-- Architectuurregels (voorstel §3): alle state in de DB, InnoDB + transacties,
-- append-only auditsporen, servertijd (UTC) leidend.
--
-- Dit is een VOORZET voor Codex (Fase 1-2). Niet definitief: kolommen/indices
-- worden per fase verfijnd met migraties. Alle tijden in UTC.

SET time_zone = '+00:00';

-- Eén vergadering en haar actuele status.
CREATE TABLE meeting (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  vve_code      VARCHAR(64)     NOT NULL,
  meeting_date  DATE            NOT NULL,
  status        ENUM('draft','open','closed','archived') NOT NULL DEFAULT 'draft',
  invite_version INT UNSIGNED   NOT NULL DEFAULT 1,
  created_at    DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_meeting_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Eén uitgenodigde eigenaarsgroep binnen een vergadering.
CREATE TABLE participant (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  meeting_id   BIGINT UNSIGNED NOT NULL,
  display_name VARCHAR(255)    NOT NULL,
  object_label VARCHAR(255)    NOT NULL,
  created_at   DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_participant_meeting (meeting_id),
  CONSTRAINT fk_participant_meeting FOREIGN KEY (meeting_id) REFERENCES meeting(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Ieder afzonderlijk stemrecht met splitsing en gewicht (rechten NIET samenvoegen).
CREATE TABLE entitlement (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  participant_id BIGINT UNSIGNED NOT NULL,
  splitsing_code VARCHAR(64)     NOT NULL,
  weight         DECIMAL(12,4)   NOT NULL,
  created_at     DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_entitlement_participant (participant_id),
  CONSTRAINT fk_entitlement_participant FOREIGN KEY (participant_id) REFERENCES participant(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Hash van de persoonlijke vergadercode; NOOIT de leesbare code opslaan.
CREATE TABLE credential (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  participant_id BIGINT UNSIGNED NOT NULL,
  meeting_id     BIGINT UNSIGNED NOT NULL,
  invite_version INT UNSIGNED    NOT NULL,
  code_hash      VARBINARY(255)  NOT NULL,   -- Argon2id/bcrypt van >=128-bit random token
  revoked_at     DATETIME(3)     NULL,
  created_at     DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_credential_participant (participant_id),
  CONSTRAINT fk_credential_participant FOREIGN KEY (participant_id) REFERENCES participant(id),
  CONSTRAINT fk_credential_meeting FOREIGN KEY (meeting_id) REFERENCES meeting(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Herstelbare, begrensde eigenaar- of beheersessie (één actief apparaat per credential).
CREATE TABLE session (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  credential_id BIGINT UNSIGNED NOT NULL,
  device_token  VARBINARY(255)  NOT NULL,
  role          ENUM('owner','admin') NOT NULL,
  last_seen_at  DATETIME(3)     NULL,       -- technische indicator, geen presentie
  expires_at    DATETIME(3)     NOT NULL,
  revoked_at    DATETIME(3)     NULL,
  created_at    DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_session_credential (credential_id),
  CONSTRAINT fk_session_credential FOREIGN KEY (credential_id) REFERENCES credential(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Presentie ('Present' = juridische registratie, niet automatisch verwijderen).
CREATE TABLE attendance (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  meeting_id     BIGINT UNSIGNED NOT NULL,
  participant_id BIGINT UNSIGNED NOT NULL,
  present        TINYINT(1)      NOT NULL DEFAULT 0,
  changed_at     DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_attendance (meeting_id, participant_id),
  CONSTRAINT fk_attendance_meeting FOREIGN KEY (meeting_id) REFERENCES meeting(id),
  CONSTRAINT fk_attendance_participant FOREIGN KEY (participant_id) REFERENCES participant(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Voorstel en de betrokken splitsingen.
CREATE TABLE motion (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  meeting_id  BIGINT UNSIGNED NOT NULL,
  title       VARCHAR(500)    NOT NULL,
  splitsingen JSON            NULL,
  created_at  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_motion_meeting (meeting_id),
  CONSTRAINT fk_motion_meeting FOREIGN KEY (meeting_id) REFERENCES meeting(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Stemronde: versie, open/sluit-tijd, status. Atomair sluiten (voorstel §3, regel 3).
CREATE TABLE round (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  motion_id   BIGINT UNSIGNED NOT NULL,
  round_version INT UNSIGNED  NOT NULL DEFAULT 1,
  status      ENUM('waiting','open','closing','closed') NOT NULL DEFAULT 'waiting',
  opened_at   DATETIME(3)     NULL,
  closed_at   DATETIME(3)     NULL,
  PRIMARY KEY (id),
  KEY idx_round_motion (motion_id),
  CONSTRAINT fk_round_motion FOREIGN KEY (motion_id) REFERENCES motion(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Append-only reeks stemwijzigingen. Per (round, entitlement) telt de LAATSTE
-- door de server geaccepteerde revisie vóór het sluitmoment. NOOIT updaten/deleten.
CREATE TABLE vote_revision (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  round_id       BIGINT UNSIGNED NOT NULL,
  entitlement_id BIGINT UNSIGNED NOT NULL,
  choice         ENUM('voor','tegen','blanco','onthouding') NOT NULL,
  accepted_at    DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3), -- servertijd
  PRIMARY KEY (id),
  KEY idx_voterev_round_entitlement (round_id, entitlement_id, id),
  CONSTRAINT fk_voterev_round FOREIGN KEY (round_id) REFERENCES round(id),
  CONSTRAINT fk_voterev_entitlement FOREIGN KEY (entitlement_id) REFERENCES entitlement(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Bevroren snapshot van presentie, quorum en uitslag bij het sluiten.
CREATE TABLE round_result (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  round_id   BIGINT UNSIGNED NOT NULL,
  snapshot   JSON            NOT NULL,   -- presentie/quorum/gewogen uitslag, onveranderlijk
  created_at DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_round_result (round_id),
  CONSTRAINT fk_roundresult_round FOREIGN KEY (round_id) REFERENCES round(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Append-only audittrail: actor, servertijd, actie, gesaneerde context.
CREATE TABLE audit_event (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  actor      VARCHAR(255)    NOT NULL,
  action     VARCHAR(128)    NOT NULL,
  context    JSON            NULL,       -- gesaneerd; geen leesbare codes/PII
  created_at DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_audit_action (action),
  KEY idx_audit_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
