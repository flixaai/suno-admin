const fs = require('fs');
const path = require('path');

class QueueManager {
  constructor() {
    this.tasks = new Map();
    this.queue = [];
    this.maxConcurrent = parseInt(process.env.MAX_CONCURRENT_JOBS) || 2;
    this.activeJobs = 0;
    this.dataPath = path.join(__dirname, '..', 'data', 'queue.json');
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(this.dataPath)) {
        const data = JSON.parse(fs.readFileSync(this.dataPath, 'utf-8'));
        data.forEach(task => this.tasks.set(task.taskId, task));
      }
    } catch (err) {
      logger.error('Failed to load queue:', err);
    }
  }

  save() {
    try {
      const data = Array.from(this.tasks.values());
      const dir = path.dirname(this.dataPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.dataPath, JSON.stringify(data.slice(-1000), null, 2)); // Keep last 1000
    } catch (err) {
      logger.error('Failed to save queue:', err);
    }
  }

  addTask(task) {
    this.tasks.set(task.taskId, task);
    this.save();
    return task;
  }

  updateTask(taskId, updates) {
    const task = this.tasks.get(taskId);
    if (!task) return null;

    Object.assign(task, updates);
    this.tasks.set(taskId, task);
    this.save();
    return task;
  }

  getTask(taskId) {
    return this.tasks.get(taskId) || null;
  }

  getAllTasks() {
    return Array.from(this.tasks.values())
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  getActiveTasks() {
    return Array.from(this.tasks.values())
      .filter(t => t.status === 'processing' || t.status === 'queued');
  }

  getActiveJobCount() {
    return this.getActiveTasks().length;
  }

  canAcceptJob() {
    return this.getActiveJobCount() < this.maxConcurrent;
  }

  deleteTask(taskId) {
    this.tasks.delete(taskId);
    this.save();
  }

  clearCompleted() {
    for (const [taskId, task] of this.tasks) {
      if (task.status === 'completed' || task.status === 'error' || task.status === 'timeout') {
        this.tasks.delete(taskId);
      }
    }
    this.save();
  }
}

module.exports = QueueManager;