import { normalizeAgentProfileId } from '../authoring/agentProfiles.js';
import { normalizeAuthoringLedger, summarizeAuthoringLedger } from '../authoring/authoringLedger.js';

export class AuthoringService {
  constructor({ sessionService }) {
    this.sessionService = sessionService;
  }

  async getBySession(sessionId = 'main') {
    const session = await this.sessionService.getSession(sessionId);
    return {
      ledger: normalizeAuthoringLedger(session.authoring),
      agentProfileId: normalizeAgentProfileId(session.settings?.activeAgentProfileId)
    };
  }

  async saveBySession(sessionId = 'main', { ledger, agentProfileId } = {}) {
    const session = await this.sessionService.getSession(sessionId);
    const nextLedger = normalizeAuthoringLedger({
      ...ledger,
      updatedAt: new Date().toISOString()
    });
    session.authoring = nextLedger;
    session.settings = {
      ...(session.settings || {}),
      activeAgentProfileId: normalizeAgentProfileId(agentProfileId || session.settings?.activeAgentProfileId)
    };
    session.updatedAt = new Date().toISOString();
    await this.sessionService.saveSession(session);
    return {
      session,
      ledger: nextLedger,
      summary: summarizeAuthoringLedger(nextLedger),
      agentProfileId: session.settings.activeAgentProfileId
    };
  }
}
