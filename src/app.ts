import { randomBytes } from 'node:crypto';
import express, { type Express, type Request, type Response } from 'express';
import session from 'express-session';
import { z } from 'zod';
import {
  loadCurrentUser,
  requireFlagChangePermission,
  requireLogin,
  requireReviewer,
} from './auth.js';
import type { Db } from './db/index.js';
import { MockFeatureFlagSystem, type FeatureFlagSystem } from './gateway/featureFlagSystem.js';
import { MockRefundGateway, type RefundGateway } from './gateway/refundGateway.js';
import {
  getFeatureFlag,
  listFeatureFlags,
  listFlagAuditEvents,
  listFlagStates,
} from './repo/flags.js';
import { getRefundRequest, getUser, listAuditEvents, listRefundRequests, listUsers } from './repo/refunds.js';
import { changeFlag } from './service/changeFlag.js';
import { decideRefund } from './service/decide.js';
import { detailPage, flagDetailPage, flagsListPage, loginPage, queuePage } from './views.js';

const decisionSchema = z.object({
  action: z.enum(['APPROVE', 'REJECT']),
  reasonNote: z.string().trim().min(1, 'A reason is required.'),
});

const flagChangeSchema = z.object({
  environment: z.enum(['development', 'production']),
  enabled: z.enum(['true', 'false']).transform((value) => value === 'true'),
  reasonNote: z.string().trim().min(1, 'A reason is required.'),
});

const loginSchema = z.object({ userId: z.string().min(1) });

export interface AppOptions {
  db: Db;
  gateway?: RefundGateway;
  flagSystem?: FeatureFlagSystem;
  sessionSecret?: string;
}

const isProduction = (): boolean => process.env.NODE_ENV === 'production';

function resolveSessionSecret(explicit?: string): string {
  const secret = explicit ?? process.env.SESSION_SECRET;
  if (secret) return secret;
  if (isProduction()) throw new Error('SESSION_SECRET must be set when NODE_ENV=production');
  return randomBytes(32).toString('hex');
}

export function createApp({
  db,
  gateway = new MockRefundGateway(),
  flagSystem = new MockFeatureFlagSystem(),
  sessionSecret,
}: AppOptions): Express {
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use(
    session({
      secret: resolveSessionSecret(sessionSecret),
      resave: false,
      saveUninitialized: false,
      cookie: { httpOnly: true, sameSite: 'strict', secure: isProduction() },
    }),
  );
  app.use((req, _res, next) => {
    req.db = db;
    next();
  });
  app.use(loadCurrentUser);

  app.get('/', (_req, res) => res.redirect('/refunds'));

  app.get('/login', (req, res) => {
    res.send(loginPage(listUsers(req.db)));
  });

  app.post('/login', (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    const user = parsed.success ? getUser(req.db, parsed.data.userId) : undefined;
    if (!user) {
      res.status(400).send(loginPage(listUsers(req.db), 'Unknown user.'));
      return;
    }
    req.session.userId = user.id;
    res.redirect('/refunds');
  });

  app.get('/logout', (req, res) => {
    req.session.destroy(() => res.redirect('/login'));
  });

  app.get('/refunds', requireLogin, (req, res) => {
    res.send(queuePage(req.currentUser!, listRefundRequests(req.db)));
  });

  app.get('/refunds/:id', requireLogin, (req, res) => {
    renderDetail(req, res);
  });

  app.post('/refunds/:id/decision', requireLogin, requireReviewer, (req, res) => {
    const refundRequestId = String(req.params.id);
    const parsed = decisionSchema.safeParse(req.body);
    if (!parsed.success) {
      renderDetail(req, res, 400, parsed.error.issues[0]?.message ?? 'Invalid request.');
      return;
    }

    const outcome = decideRefund(req.db, gateway, {
      actor: req.currentUser!,
      refundRequestId,
      action: parsed.data.action,
      reasonNote: parsed.data.reasonNote,
    });

    if (outcome.ok) {
      res.redirect(`/refunds/${refundRequestId}`);
      return;
    }

    const statusByFailure = {
      NOT_FOUND: 404,
      FORBIDDEN_ROLE: 403,
      REASON_REQUIRED: 400,
      NOT_PENDING: 409,
      GATEWAY_FAILURE: 502,
    } as const;
    renderDetail(req, res, statusByFailure[outcome.failure], outcome.message);
  });

  app.get('/flags', requireLogin, (req, res) => {
    const flags = listFeatureFlags(req.db);
    const states = flags.flatMap((flag) => listFlagStates(req.db, flag.id));
    res.send(flagsListPage(req.currentUser!, flags, states));
  });

  app.get('/flags/:id', requireLogin, (req, res) => {
    renderFlagDetail(req, res);
  });

  app.post('/flags/:id/change', requireLogin, requireFlagChangePermission, (req, res) => {
    const flagId = String(req.params.id);
    const parsed = flagChangeSchema.safeParse(req.body);
    if (!parsed.success) {
      renderFlagDetail(req, res, 400, parsed.error.issues[0]?.message ?? 'Invalid request.');
      return;
    }

    const outcome = changeFlag(req.db, flagSystem, {
      actor: req.currentUser!,
      flagId,
      environment: parsed.data.environment,
      enabled: parsed.data.enabled,
      reasonNote: parsed.data.reasonNote,
    });

    // A no-op toggle is not an error: nothing was written, and the caller is
    // sent back to the detail page exactly as a successful change would be.
    if (outcome.ok || outcome.failure === 'NO_OP') {
      res.redirect(`/flags/${flagId}`);
      return;
    }

    const statusByFailure = {
      NOT_FOUND: 404,
      FORBIDDEN_ROLE: 403,
      REASON_REQUIRED: 400,
      CONFLICT: 409,
      EXTERNAL_FAILURE: 502,
    } as const;
    renderFlagDetail(req, res, statusByFailure[outcome.failure], outcome.message);
  });

  return app;
}

function renderDetail(req: Request, res: Response, status = 200, error?: string): void {
  const request = getRefundRequest(req.db, String(req.params.id));
  if (!request) {
    res.status(404).send('Refund request not found');
    return;
  }
  res
    .status(status)
    .send(detailPage(req.currentUser!, request, listAuditEvents(req.db, request.id), error));
}

function renderFlagDetail(req: Request, res: Response, status = 200, error?: string): void {
  const flag = getFeatureFlag(req.db, String(req.params.id));
  if (!flag) {
    res.status(404).send('Feature flag not found');
    return;
  }
  res
    .status(status)
    .send(
      flagDetailPage(
        req.currentUser!,
        flag,
        listFlagStates(req.db, flag.id),
        listFlagAuditEvents(req.db, flag.id),
        error,
      ),
    );
}
