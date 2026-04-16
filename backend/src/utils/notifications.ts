import fs from 'fs';
import path from 'path';

export function notifyAdmin(message: string) {
    const logPath = path.join('/tmp', 'sevak_alerts.log');
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] ALERT: ${message}\n---\n`);
    console.log("SEVAK_NOTIFICATION_TRIGGER:", message);
}
