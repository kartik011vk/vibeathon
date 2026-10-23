// Controllers for responder organisations, team offers and supply donations.
import * as orgs from '../services/organization.service.js';
import * as offers from '../services/offer.service.js';
import * as supplies from '../services/supplyOffer.service.js';
import * as sos from '../services/sos.service.js';
import { confirmReceipt } from '../services/request.service.js';
import * as hazards from '../services/hazard.service.js';
import { REFRESH_COOKIE, refreshCookieOptions } from './auth.controller.js';
import { config } from '../config/env.js';
import { created, ok } from '../utils/respond.js';

const p = (req, name) => req.valid.params[name];

function withSession(res, result, delivery) {
  res.cookie(REFRESH_COOKIE, result.refreshToken, refreshCookieOptions());
  return {
    user: result.user,
    organization: result.organization,
    accessToken: result.accessToken,
    tokenType: 'Bearer',
    expiresIn: config.ACCESS_TOKEN_TTL,
    ...(delivery === 'body' ? { refreshToken: result.refreshToken } : {}),
  };
}

export const orgCtl = {
  register: async (req, res) => {
    const { tokenDelivery, ...input } = req.valid.body;
    created(res, withSession(res, await orgs.registerOrganization(input, req), tokenDelivery));
  },
  join: async (req, res) => {
    const { tokenDelivery, ...input } = req.valid.body;
    created(res, withSession(res, await orgs.joinOrganization(input, req), tokenDelivery));
  },
  mine: async (req, res) => ok(res, await orgs.getMyOrganization(req.user)),
  rotateCode: async (req, res) => ok(res, await orgs.rotateJoinCode(req.user, req)),
  decideMember: async (req, res) => ok(res, await orgs.decideMember(req.user, p(req, 'userId'), req.valid.body.decision, req)),
  list: async (req, res) => {
    const { items, meta } = await orgs.listOrganizations(req.valid.query);
    ok(res, items, meta);
  },
  get: async (req, res) => ok(res, await orgs.getOrganization(p(req, 'organizationId'))),
  approve: async (req, res) => ok(res, await orgs.approveOrganization(req.user, p(req, 'organizationId'), req.valid.body, req)),
  reject: async (req, res) => ok(res, await orgs.rejectOrganization(req.user, p(req, 'organizationId'), req.valid.body, req)),
};

export const offerCtl = {
  openNeeds: async (req, res) => {
    const { items, meta } = await offers.openNeeds(req.user, req.valid.query);
    ok(res, items, meta);
  },
  create: async (req, res) => created(res, await offers.createOffer(req.user, p(req, 'requestId'), req.valid.body, req)),
  list: async (req, res) => ok(res, await offers.listOffers(req.user, p(req, 'requestId'))),
  withdraw: async (req, res) => ok(res, await offers.withdrawOffer(req.user, p(req, 'requestId'), p(req, 'offerId'), req)),
};

export const supplyCtl = {
  create: async (req, res) => created(res, await supplies.createOffer(req.user, req.valid.body, req)),
  list: async (req, res) => {
    const { items, meta } = await supplies.listOffers(req.user, req.valid.query);
    ok(res, items, meta);
  },
  get: async (req, res) => ok(res, await supplies.getOffer(req.user, p(req, 'offerId'))),
  accept: async (req, res) => ok(res, await supplies.acceptOffer(req.user, p(req, 'offerId'), req.valid.body, req)),
  receive: async (req, res) => ok(res, await supplies.receiveOffer(req.user, p(req, 'offerId'), req.valid.body, req)),
  reject: async (req, res) => ok(res, await supplies.rejectOffer(req.user, p(req, 'offerId'), req.valid.body, req)),
  cancel: async (req, res) => ok(res, await supplies.cancelOffer(req.user, p(req, 'offerId'), req.valid.body, req)),
};

export const sosCtl = {
  raise: async (req, res) => created(res, await sos.raiseSos(req.user, req.valid.body, req)),
  active: async (req, res) => {
    const items = await sos.activeSos(req.user);
    ok(res, items, { count: items.length, scope: req.user && sos.SOS_RESPONDERS.includes(req.user.role) ? 'responder' : 'public' });
  },
  mine: async (req, res) => ok(res, await sos.mySos(req.user)),
  get: async (req, res) => ok(res, await sos.getSos(req.user, p(req, 'sosId'))),
  location: async (req, res) => ok(res, await sos.updateSosLocation(req.user, p(req, 'sosId'), req.valid.body, req)),
  respond: async (req, res) => ok(res, await sos.respond(req.user, p(req, 'sosId'), req)),
  resolve: async (req, res) => ok(res, await sos.resolve(req.user, p(req, 'sosId'), req.valid.body, req)),
  cancel: async (req, res) => ok(res, await sos.cancel(req.user, p(req, 'sosId'), req.valid.body, req)),
};

export const confirmReceiptCtl = async (req, res) => ok(res, await confirmReceipt(req.user, p(req, 'requestId'), req.valid.body, req));

export const hazardCtl = {
  list: async (req, res) => {
    const [{ items, total }, feeds] = await Promise.all([hazards.listHazards(req.valid.query), hazards.feedStatus()]);
    ok(res, items, { total, feeds, region: 'India' });
  },
  status: async (req, res) => ok(res, await hazards.feedStatus()),
  refresh: async (req, res) => ok(res, await hazards.runFeeds()),
  zone: async (req, res) => created(res, await hazards.createZone(req.user, p(req, 'hazardId'), req.valid.body, req)),
};
