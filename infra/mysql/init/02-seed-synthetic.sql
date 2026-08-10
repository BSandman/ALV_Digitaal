-- SYNTHETISCHE testdata — uitsluitend fictief. NOOIT productie-eigenaarsdata (voorstel §2.2, AVG).
-- Wordt automatisch geladen in de dev/test-container. Niet gebruiken in productie.

INSERT INTO meeting (vve_code, meeting_date, status, invite_version)
VALUES ('VVE-TEST-001', '2026-09-01', 'draft', 1);

-- 120 fictieve deelnemers + één stemrecht elk, voor de belastingstest van Gemini.
INSERT INTO participant (meeting_id, display_name, object_label)
SELECT 1,
       CONCAT('Test Eigenaar ', LPAD(seq, 3, '0')),
       CONCAT('Appartement ', LPAD(seq, 3, '0'))
FROM (
  SELECT (a.n + b.n*10 + c.n*100 + 1) AS seq
  FROM (SELECT 0 n UNION SELECT 1 UNION SELECT 2 UNION SELECT 3 UNION SELECT 4
        UNION SELECT 5 UNION SELECT 6 UNION SELECT 7 UNION SELECT 8 UNION SELECT 9) a
  CROSS JOIN (SELECT 0 n UNION SELECT 1 UNION SELECT 2 UNION SELECT 3 UNION SELECT 4
        UNION SELECT 5 UNION SELECT 6 UNION SELECT 7 UNION SELECT 8 UNION SELECT 9) b
  CROSS JOIN (SELECT 0 n UNION SELECT 1) c
) nums
WHERE seq <= 120;

INSERT INTO entitlement (participant_id, splitsing_code, weight)
SELECT id, CONCAT('A-', LPAD(id, 3, '0')), 1.0000
FROM participant;
