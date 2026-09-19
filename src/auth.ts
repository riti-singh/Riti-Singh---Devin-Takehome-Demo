import type { NextFunction, Request, Response } from 'express';
import type { Db } from './db/index.js';
import { canDecide } from './domain/rules.js';
import type { User } from './domain/types.js';
import { getUser } from './repo/refunds.js';

declare module 'express-session' {
  interface SessionData {
    userId?: string;
  }
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      currentUser?: User;
      db: Db;
    }
  }
}

export function loadCurrentUser(req: Request, _res: Response, next: NextFunction): void {
  const id = req.session?.userId;
  req.currentUser = id ? getUser(req.db, id) : undefined;
  next();
}

export function requireLogin(req: Request, res: Response, next: NextFunction): void {
  if (!req.currentUser) {
    res.redirect('/login');
    return;
  }
  next();
}

/** Server-side enforcement point for mutations; UI button hiding is cosmetic only. */
export function requireReviewer(req: Request, res: Response, next: NextFunction): void {
  const user = req.currentUser;
  if (!user) {
    res.status(401).send('Not logged in');
    return;
  }
  if (!canDecide(user.role)) {
    res.status(403).send('Forbidden: your role is read-only.');
    return;
  }
  next();
}
