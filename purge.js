// Comptes désactivés depuis plus de 24 h : supprimés automatiquement.
// L'historique (ventes, paies, messages) reste dans la compta, rattaché à un « ancien chatter » anonyme.
module.exports = function mount(app, db, auth, admin, ctx) {
  const { gest } = ctx, DELAY = 24 * 3600e3;
  const has = t => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
  const run = (sql, ...a) => { try { db.prepare(sql).run(...a); } catch (e) {} };
  function sweep() { try {
    const now = Date.now();
    // date de désactivation : notée la première fois qu'on voit le compte désactivé, effacée s'il est réactivé
    db.prepare("UPDATE users SET deactivated_at = ? WHERE active = 0 AND deactivated_at IS NULL AND deleted_at IS NULL").run(now);
    db.prepare("UPDATE users SET deactivated_at = NULL WHERE active = 1 AND deactivated_at IS NOT NULL").run();
    const due = db.prepare("SELECT id, username, role FROM users WHERE active = 0 AND deleted_at IS NULL AND role <> 'admin' AND deactivated_at <= ?").all(now - DELAY);
    due.forEach(u => {
      const label = u.role === "trainee" ? "ancien-eleve" : "ancien-chatter";
      let name = `${label}-${u.id}`; while (db.prepare("SELECT 1 FROM users WHERE username = ? AND id <> ?").get(name, u.id)) name += "x";
      const tx = () => { db.exec("BEGIN"); try {
        db.prepare("UPDATE users SET username = ?, pass_hash = '!', deleted_at = ? WHERE id = ?").run(name, now, u.id);
        run("DELETE FROM tokens WHERE user_id = ?", u.id);
        // données personnelles de la candidature
        if (has("applications")) run("UPDATE applications SET first_name = 'Ancien compte', contact = '', motivation = '', test_reply = '', test_answers = NULL, ip_hash = NULL WHERE user_id = ?", u.id);
        for (const t of ["chat_members", "chat_reads", "trainee_deadline", "training_ready", "chat_mutes"]) if (has(t)) run(`DELETE FROM ${t} WHERE user_id = ?`, u.id);
        if (has("team_leads")) run("DELETE FROM team_leads WHERE recruit_id = ? OR leader_id = ?", u.id, u.id);
        run("DELETE FROM settings WHERE key = ?", "planprefs:" + u.id);
      db.exec("COMMIT"); } catch (e) { try { db.exec("ROLLBACK"); } catch (_) {} throw e; } }; tx();
      gest.log(null, "a", `Compte de **${u.username}** supprimé automatiquement`, "Désactivé depuis plus de 24 h · ventes et paies gardées dans la compta sous « " + name + " »");
    });
  } catch (e) { console.error("suppression des comptes", e.message); } }
  setInterval(sweep, 15 * 60e3).unref(); setTimeout(sweep, 20e3).unref();
  return { sweep, DELAY };
};
