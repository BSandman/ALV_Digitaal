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
  code_lookup_hash BINARY(32)    NOT NULL,   -- HMAC-SHA-256 voor lookup; pepper blijft buiten DB
  code_hash      VARBINARY(255)  NOT NULL,   -- memory-hard scrypt/Argon2id-hash van >=128-bit token
  failed_attempts INT UNSIGNED   NOT NULL DEFAULT 0,
  locked_until   DATETIME(3)     NULL,
  last_authenticated_at DATETIME(3) NULL,
  revoked_at     DATETIME(3)     NULL,
  created_at     DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_credential_lookup (code_lookup_hash),
  KEY idx_credential_participant (participant_id),
  CONSTRAINT fk_credential_participant FOREIGN KEY (participant_id) REFERENCES participant(id),
  CONSTRAINT fk_credential_meeting FOREIGN KEY (meeting_id) REFERENCES meeting(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Herstelbare, begrensde eigenaar- of beheersessie (één actief apparaat per credential).
CREATE TABLE session (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  credential_id BIGINT UNSIGNED NOT NULL,
  session_token_hash BINARY(32) NOT NULL,
  device_binding_hash BINARY(32) NOT NULL,
  role          ENUM('owner','admin') NOT NULL,
  last_seen_at  DATETIME(3)     NULL,       -- technische indicator, geen presentie
  expires_at    DATETIME(3)     NOT NULL,
  revoked_at    DATETIME(3)     NULL,
  created_at    DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_session_token (session_token_hash),
  KEY idx_session_credential (credential_id),
  CONSTRAINT fk_session_credential FOREIGN KEY (credential_id) REFERENCES credential(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Append-only authenticatiespoor voor begrenzing per IP én per credential.
-- IP en ingevoerde code worden uitsluitend als keyed hash opgeslagen.
CREATE TABLE authentication_attempt (
  id                     BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  credential_id          BIGINT UNSIGNED NULL,
  credential_lookup_hash BINARY(32)      NOT NULL,
  client_ip_hash         BINARY(32)      NOT NULL,
  succeeded              TINYINT(1)      NOT NULL,
  attempted_at           DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_auth_attempt_ip_time (client_ip_hash, attempted_at),
  KEY idx_auth_attempt_credential_time (credential_lookup_hash, attempted_at),
  CONSTRAINT fk_auth_attempt_credential FOREIGN KEY (credential_id) REFERENCES credential(id)
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
  opening_attendance_numerator SMALLINT UNSIGNED NULL,
  opening_attendance_denominator SMALLINT UNSIGNED NULL,
  majority_numerator SMALLINT UNSIGNED NOT NULL DEFAULT 2,
  majority_denominator SMALLINT UNSIGNED NOT NULL DEFAULT 3,
  created_at  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_motion_meeting (meeting_id),
  CONSTRAINT chk_motion_opening_ratio CHECK (
    (opening_attendance_numerator IS NULL AND opening_attendance_denominator IS NULL)
    OR (opening_attendance_numerator BETWEEN 1 AND opening_attendance_denominator)
  ),
  CONSTRAINT chk_motion_majority_ratio CHECK (majority_numerator BETWEEN 1 AND majority_denominator),
  CONSTRAINT fk_motion_meeting FOREIGN KEY (meeting_id) REFERENCES meeting(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Stemronde: versie, open/sluit-tijd, status. Atomair sluiten (voorstel §3, regel 3).
CREATE TABLE round (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  motion_id   BIGINT UNSIGNED NOT NULL,
  round_version INT UNSIGNED  NOT NULL DEFAULT 1,
  status      ENUM('waiting','open','closing','closed') NOT NULL DEFAULT 'waiting',
  opened_at   DATETIME(3)     NULL,
  closes_at   DATETIME(3)     NULL,
  closed_at   DATETIME(3)     NULL,
  PRIMARY KEY (id),
  KEY idx_round_motion (motion_id),
  CONSTRAINT fk_round_motion FOREIGN KEY (motion_id) REFERENCES motion(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Registratie van een papieren machtiging per appartementsrecht. Een status
-- invalidated_owner_login is eindtoestand en kan niet worden teruggedraaid.
CREATE TABLE power_of_attorney (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  meeting_id     BIGINT UNSIGNED NOT NULL,
  entitlement_id BIGINT UNSIGNED NOT NULL,
  status         ENUM('active','invalidated_owner_login') NOT NULL DEFAULT 'active',
  invalidated_at DATETIME(3) NULL,
  created_at     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_power_of_attorney (meeting_id, entitlement_id),
  CONSTRAINT fk_power_meeting FOREIGN KEY (meeting_id) REFERENCES meeting(id),
  CONSTRAINT fk_power_entitlement FOREIGN KEY (entitlement_id) REFERENCES entitlement(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DELIMITER //
CREATE TRIGGER trg_power_of_attorney_irreversible
BEFORE UPDATE ON power_of_attorney
FOR EACH ROW
BEGIN
  IF OLD.status = 'invalidated_owner_login' AND NEW.status <> OLD.status THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'power_of_attorney_invalidation_is_irreversible';
  END IF;
END//
DELIMITER ;

-- ADR-0009: één vergadering-brede, door de voorzitter bevroren quorumstaat.
-- De detailregels bewaren exact welke rechten op dat moment deelnamen, zonder
-- dubbeltelling wanneer een recht zowel present als gemachtigd geregistreerd was.
CREATE TABLE meeting_quorum (
  meeting_id          BIGINT UNSIGNED NOT NULL,
  quorum_met          TINYINT(1)      NOT NULL,
  basis_weight        DECIMAL(12,4)   NOT NULL,
  eligible_weight     DECIMAL(12,4)   NOT NULL,
  quorum_numerator    SMALLINT UNSIGNED NOT NULL,
  quorum_denominator  SMALLINT UNSIGNED NOT NULL,
  set_by              VARCHAR(255)    NOT NULL,
  set_at              DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (meeting_id),
  CONSTRAINT chk_meeting_quorum_flag CHECK (quorum_met IN (0, 1)),
  CONSTRAINT chk_meeting_quorum_weights CHECK (basis_weight >= 0 AND eligible_weight >= basis_weight),
  CONSTRAINT chk_meeting_quorum_ratio CHECK (quorum_numerator BETWEEN 1 AND quorum_denominator),
  CONSTRAINT fk_meetingquorum_meeting FOREIGN KEY (meeting_id) REFERENCES meeting(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE meeting_quorum_entitlement (
  meeting_id          BIGINT UNSIGNED NOT NULL,
  entitlement_id      BIGINT UNSIGNED NOT NULL,
  attendance_present  TINYINT(1)      NOT NULL,
  power_submitted     TINYINT(1)      NOT NULL,
  weight_snapshot     DECIMAL(12,4)   NOT NULL,
  PRIMARY KEY (meeting_id, entitlement_id),
  CONSTRAINT chk_quorum_entitlement_sources CHECK (
    attendance_present IN (0, 1) AND power_submitted IN (0, 1)
    AND (attendance_present = 1 OR power_submitted = 1)
  ),
  CONSTRAINT fk_quorumentitlement_meeting FOREIGN KEY (meeting_id) REFERENCES meeting(id),
  CONSTRAINT fk_quorumentitlement_entitlement FOREIGN KEY (entitlement_id) REFERENCES entitlement(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DELIMITER //
CREATE TRIGGER trg_meeting_quorum_immutable_update
BEFORE UPDATE ON meeting_quorum FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'meeting_quorum_is_frozen';
END//
CREATE TRIGGER trg_meeting_quorum_immutable_delete
BEFORE DELETE ON meeting_quorum FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'meeting_quorum_is_frozen';
END//
CREATE TRIGGER trg_quorum_entitlement_immutable_update
BEFORE UPDATE ON meeting_quorum_entitlement FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'meeting_quorum_entitlements_are_frozen';
END//
CREATE TRIGGER trg_quorum_entitlement_immutable_delete
BEFORE DELETE ON meeting_quorum_entitlement FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'meeting_quorum_entitlements_are_frozen';
END//
CREATE TRIGGER trg_quorum_entitlement_frozen_insert
BEFORE INSERT ON meeting_quorum_entitlement FOR EACH ROW
BEGIN
  IF EXISTS (SELECT 1 FROM meeting_quorum WHERE meeting_id = NEW.meeting_id) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'meeting_quorum_entitlements_are_frozen';
  END IF;
END//
DELIMITER ;

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

-- ADR-0010: ieder deelnemend recht zonder tijdige stem wordt bij sluiten
-- individueel en onveranderlijk als onthouding geregistreerd.
CREATE TABLE round_automatic_abstention (
  round_id        BIGINT UNSIGNED NOT NULL,
  entitlement_id BIGINT UNSIGNED NOT NULL,
  weight_snapshot DECIMAL(12,4)  NOT NULL,
  registered_at  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (round_id, entitlement_id),
  CONSTRAINT fk_autoabstention_round FOREIGN KEY (round_id) REFERENCES round(id),
  CONSTRAINT fk_autoabstention_entitlement FOREIGN KEY (entitlement_id) REFERENCES entitlement(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DELIMITER //
CREATE TRIGGER trg_auto_abstention_immutable_update
BEFORE UPDATE ON round_automatic_abstention FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'automatic_abstention_is_immutable';
END//
CREATE TRIGGER trg_auto_abstention_immutable_delete
BEFORE DELETE ON round_automatic_abstention FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'automatic_abstention_is_immutable';
END//
CREATE TRIGGER trg_auto_abstention_only_while_closing
BEFORE INSERT ON round_automatic_abstention FOR EACH ROW
BEGIN
  IF (SELECT status FROM round WHERE id = NEW.round_id) <> 'closing' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'automatic_abstention_requires_closing_round';
  END IF;
END//
DELIMITER ;

-- Bevroren snapshot: verwijst naar vergaderingquorum en bevat de ronde-meerderheid.
CREATE TABLE round_result (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  round_id   BIGINT UNSIGNED NOT NULL,
  snapshot   JSON            NOT NULL,
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
