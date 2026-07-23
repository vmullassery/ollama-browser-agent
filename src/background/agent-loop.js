(function () {
  // The model's real, emittable action vocabulary (see buildDecidePrompt in service-worker.js) is
  // only: click | type | scroll | extract | click-coordinates | done. None of those match a
  // "submit"/"purchase"/"download"/"navigate-new-domain" type, so sensitivity has to be inferred
  // from the action's target rather than from action.type alone:
  //  - a coordinate-based click can't be pre-classified (no element context), so it's always
  //    treated as sensitive under approve-sensitive mode — safer default.
  //  - a DOM click is sensitive when the target element's visible text looks like a
  //    submit/purchase/download/destructive control.
  const SENSITIVE_TEXT_PATTERN = /submit|buy|purchase|checkout|pay|download|delete/i;

  function isSensitiveAction(action, elements) {
    if (!action) return false;
    if (action.type === 'click-coordinates') return true;
    if (action.type === 'click' && Array.isArray(elements)) {
      const el = elements.find((candidate) => candidate.id === action.elementId);
      if (el && SENSITIVE_TEXT_PATTERN.test(el.text || '')) return true;
    }
    return false;
  }

  const MAX_STEPS = 25;
  const MAX_CONSECUTIVE_FAILURES = 1;

  async function runStep({ task, deps, history }) {
    const observation = await deps.observe(task);
    const action = await deps.decide(task, observation, history);

    const needsApproval = task.autonomyMode === 'approve-all'
      || (task.autonomyMode === 'approve-sensitive' && isSensitiveAction(action, observation?.elements));

    if (needsApproval) {
      const approved = await deps.requestApproval(action);
      if (!approved) {
        return { action, observation, status: 'rejected' };
      }
    }

    try {
      const result = await deps.execute(action);
      return { action, observation, status: 'done', result };
    } catch (error) {
      return { action, observation, status: 'failed', error: error.message };
    }
  }

  async function runTask(task, deps) {
    const history = [];
    let consecutiveFailures = 0;

    for (let step = 0; step < MAX_STEPS; step++) {
      const stepResult = await runStep({ task, deps, history });
      history.push(stepResult);
      await deps.recordStep(stepResult);

      if (stepResult.status === 'rejected') {
        return { status: 'stopped', reason: 'rejected', steps: history };
      }

      if (stepResult.status === 'failed') {
        consecutiveFailures += 1;
        if (consecutiveFailures > MAX_CONSECUTIVE_FAILURES) {
          return { status: 'failed', reason: 'too many consecutive failures', steps: history };
        }
        continue;
      }

      consecutiveFailures = 0;

      if (stepResult.action?.type === 'done') {
        return { status: 'success', steps: history };
      }
    }

    return { status: 'failed', reason: 'max steps exceeded', steps: history };
  }

  globalThis.OBA_AgentLoop = { runStep, runTask, isSensitiveAction, SENSITIVE_TEXT_PATTERN, MAX_STEPS, MAX_CONSECUTIVE_FAILURES };
})();
