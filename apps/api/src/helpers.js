import { Types } from 'mongoose';
import { AuditLog, PlatformAuditLog } from './models.js';
export const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
export const validId = (value) => typeof value === 'string' && Types.ObjectId.isValid(value) && new Types.ObjectId(value).toString() === value.toLowerCase();
export const id = (value) => new Types.ObjectId(value);
export const audit = async (req, action, entity, entityId, meta = {}) => {
    const a = req.auth;
    if (!a?.schoolId || !a.sub)
        return;
    await AuditLog.create({ actorId: id(a.sub), role: a.role, action, entity, entityId: entityId ? String(entityId) : '', meta });
};
/** Records a super-admin action. Never throws: history must not break the action itself. */
export const platformAudit = async (req, action, targetSchoolId, meta = {}) => {
    const a = req.auth;
    if (a?.tokenType !== 'platform_admin' || !a.sub)
        return;
    try {
        await PlatformAuditLog.create({ actorId: id(a.sub), action, targetSchoolId: targetSchoolId ? id(targetSchoolId) : null, entity: 'school', entityId: targetSchoolId || '', meta });
    }
    catch { /* logged by request logger on the next error; do not fail the admin action */ }
};
export const requireBody = (schema, body) => schema.parse(body);
export function paginatedLimit(raw, max = 200) {
    const n = Number(raw ?? 50);
    return Number.isInteger(n) ? Math.min(max, Math.max(1, n)) : 50;
}
