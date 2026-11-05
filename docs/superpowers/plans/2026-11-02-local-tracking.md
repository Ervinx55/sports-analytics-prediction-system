# Local tracking and quota containment
Approved direction: stop unnecessary hosted transfers and run research tracking locally while Supabase is restricted.

Design: reuse runNbaResearch and its exact event/result validation with an isolated Node SQLite repository. Store first snapshots, import original archived forecast timestamps without rewriting them, persist cooldowns, and keep every result research-only. Serve a read-only dashboard on 127.0.0.1:8782. Poll every 15 minutes with no overlapping runs; save process/run status, offer start/stop scripts, and never install startup tasks or change billing. Local records are not automatically uploaded or promoted. Current scope is the existing NBA team tracker; NFL/props require their own identity/result adapters before claiming support.

1. Audit aggregate response sizes and scheduled failed requests. Save a reversible job manifest; pause only jobs verified to be repeatedly returning quota errors. Document that log sizes are not a billing total.
2. Add tests for immutable SQLite captures, preserved archive timestamps, pregame checks, restart persistence, duplicate prevention and cooldowns. Implement local repository.
3. Add CLI one-shot/watch modes, localhost report and safe shutdown. Use existing bounded provider fetches. Import the saved 130-forecast archive; verify actual final-score outcomes without claiming wager ROI.
4. Run full Node tests, start the local monitor hidden, verify status/report HTTP, and publish code and instructions to the existing PR. Runtime ledger/logs stay ignored by Git.
