import express, { type Express, type Request, type Response } from 'express';
import session from 'express-session';
import { z } from 'zod';
import { loadCurrentUser, requireLogin, requireReviewer } from './auth.js';
import type { Db } from './db/index.js';
import { MockRefundGateway, type RefundGateway } from './gateway/refundGateway.js';
import { getRefundRequest, getUser, listAuditEvents, listRefundRequests, listUsers } from './repo/refunds.js';
import { decideRefund } from './service/decide.js';
import { detailPage, loginPage, queuePage } from './views.js';

const decisionSchema = z.object({
  action: z.enum(['APPROVE', 'REJECT']),
  reasonNote: z.string().trim().min(1, 'A reason is required.'),
});

const loginSchema = z.object({ userId: z.string().min(1) });

export interface AppOptions {
  db: Db;
  gateway?: RefundGateway;
  sessionSecret?: string;
}

export function createApp({ db, gateway = new MockRefundGateway(), sessionSecret }: AppOptions): Express {
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use(
    session({
      secret: sessionSecret ?? process.env.SESSION_SECRET ?? 'dev-only-refund-ops-secret',
      resave: false,
      saveUninitialized: false,
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
