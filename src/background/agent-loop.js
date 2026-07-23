(function () {
  const SENSITIVE_ACTION_TYPES = new Set(['submit', 'purchase', 'download', 'navigate-new-domain']);
  const MAX_STEPS = 25;
  const MAX_CONSECUTIVE_FAILURES = 1;

  function isSensitiveAction(action) {
    return SENSITIVE_ACTION_TYPES.has(action?.type);
  }

  async function runStep({ task, deps, history }) {
    const observation = await deps.observe(task);
    const action = await deps.decide(task, observation, history);

    const needsApproval = task.autonomyMode === 'approve-all'
      || (task.autonomyMode === 'approve-sensitive' && isSensitiveAction(action));

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

  globalThis.OBA_AgentLoop = { runStep, runTask, isSensitiveAction, SENSITIVE_ACTION_TYPES, MAX_STEPS, MAX_CONSECUTIVE_FAILURES };
})();
