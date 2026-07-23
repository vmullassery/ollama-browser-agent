(function () {
  const VALID_STRATEGIES = ['dom', 'visual'];
  const VALID_AUTONOMY_MODES = ['autonomous', 'approve-sensitive', 'approve-all'];

  function createTask(input) {
    return {
      id: input.id || globalThis.OBA_Id.generateId(),
      name: input.name,
      prompt: input.prompt,
      startUrl: input.startUrl || null,
      providerProfileId: input.providerProfileId,
      strategy: input.strategy || 'dom',
      autonomyMode: input.autonomyMode || 'autonomous',
      schedule: input.schedule || null
    };
  }

  function validateTask(task) {
    const errors = [];
    if (!task || typeof task !== 'object') {
      return ['task must be an object'];
    }
    if (!task.name || typeof task.name !== 'string') errors.push('name is required');
    if (!task.prompt || typeof task.prompt !== 'string') errors.push('prompt is required');
    if (!task.providerProfileId) errors.push('providerProfileId is required');
    if (!VALID_STRATEGIES.includes(task.strategy)) {
      errors.push(`strategy must be one of ${VALID_STRATEGIES.join(', ')}`);
    }
    if (!VALID_AUTONOMY_MODES.includes(task.autonomyMode)) {
      errors.push(`autonomyMode must be one of ${VALID_AUTONOMY_MODES.join(', ')}`);
    }

    if (task.schedule) {
      if (task.schedule.type === 'once') {
        if (typeof task.schedule.at !== 'number') errors.push('schedule.at must be a timestamp for type "once"');
      } else if (task.schedule.type === 'recurring') {
        if (typeof task.schedule.hour !== 'number' || task.schedule.hour < 0 || task.schedule.hour > 23) {
          errors.push('schedule.hour must be 0-23');
        }
        if (typeof task.schedule.minute !== 'number' || task.schedule.minute < 0 || task.schedule.minute > 59) {
          errors.push('schedule.minute must be 0-59');
        }
        if (!Array.isArray(task.schedule.daysOfWeek) || task.schedule.daysOfWeek.length === 0) {
          errors.push('schedule.daysOfWeek must be a non-empty array');
        }
      } else {
        errors.push('schedule.type must be "once" or "recurring"');
      }
    }

    return errors;
  }

  globalThis.OBA_TaskModel = { createTask, validateTask, VALID_STRATEGIES, VALID_AUTONOMY_MODES };
})();
