-- ============================================================
-- Asteroids PvP — allow the new lobby mode
--
-- `lobbies.mode` has a CHECK constraint limiting it to '1v1' / '2v2'.
-- Asteroids PvP reuses the exact same lobbies/lobby_members tables and
-- matchmaking code (it's just filtered by mode like everything else), so it
-- only needs this constraint widened to also accept 'ast1v1'.
--
-- Run this once in the Supabase SQL editor (Project → SQL Editor → New query).
-- ============================================================

alter table lobbies drop constraint if exists lobbies_mode_check;

alter table lobbies
  add constraint lobbies_mode_check
  check (mode in ('1v1', '2v2', 'ast1v1'));
