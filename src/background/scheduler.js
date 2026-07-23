(function () {
  function computeNextRunTimestamp(schedule, nowMs) {
    if (!schedule) return null;

    if (schedule.type === 'once') {
      return schedule.at > nowMs ? schedule.at : null;
    }

    if (schedule.type === 'recurring') {
      const nowDate = new Date(nowMs);
      for (let dayOffset = 0; dayOffset <= 7; dayOffset++) {
        const candidate = new Date(nowDate);
        candidate.setDate(nowDate.getDate() + dayOffset);
        candidate.setHours(schedule.hour, schedule.minute, 0, 0);
        if (schedule.daysOfWeek.includes(candidate.getDay()) && candidate.getTime() > nowMs) {
          return candidate.getTime();
        }
      }
      return null;
    }

    return null;
  }

  function alarmNameForTask(taskId) {
    return `oba-task-${taskId}`;
  }

  function wireScheduler(deps) {
    const { getTasks, saveTask, runTask, alarms, now } = deps;

    async function scheduleTask(task) {
      if (!task.schedule) return;
      const nextRun = computeNextRunTimestamp(task.schedule, now());
      if (nextRun) {
        alarms.create(alarmNameForTask(task.id), { when: nextRun });
      }
    }

    async function onAlarm(alarm) {
      const match = alarm.name.match(/^oba-task-(.+)$/);
      if (!match) return;

      const taskId = match[1];
      const tasks = await getTasks();
      const task = tasks.find((t) => t.id === taskId);
      if (!task) return;

      await runTask(task);

      if (task.schedule.type === 'once') {
        task.schedule = null;
        await saveTask(task);
      } else {
        await scheduleTask(task);
      }
    }

    alarms.onAlarm.addListener(onAlarm);
    return { scheduleTask, onAlarm };
  }

  globalThis.OBA_Scheduler = { computeNextRunTimestamp, alarmNameForTask, wireScheduler };
})();
