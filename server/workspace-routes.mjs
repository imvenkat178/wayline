import {protectConversationInput} from './domain/conversationPrivacy.mjs';
import { travelerActions } from '../shared/travelerActions.mjs';
import { submitConversationExecution, runConversationExecution, executionView, cancelConversationExecution, retryConversationExecution } from './domain/conversationExecution.mjs';
import { createConversation, listConversations, workspaceSnapshot, runWorkspaceTurn } from "./domain/tripWorkspace.mjs";
import { DomainError } from "./domain/journeys.mjs";

export async function workspaceRoutes({ req, res, url, b, store, session, send, travel, rateLimit }) {
  const userId = session.userId;
  if(url.pathname==='/api/conversation-actions' && req.method==='GET'){send(res,200,travelerActions);return true;}
  const execution=url.pathname.match(/^\/api\/conversations\/([^/]+)\/executions\/([^/]+)(\/(?:cancel|retry))?$/);
  if(execution) {
    const e=executionView(store,userId,execution[2],Math.max(0,Number(url.searchParams.get('after')??0)));
    if(e.conversationId!==execution[1])throw new DomainError('Execution not found.',404);
    if(req.method==='GET'&&!execution[3])send(res,200,e);
    else if(req.method==='POST'&&execution[3])send(res,200,execution[3]==='/retry'?retryConversationExecution(store,userId,e.id):cancelConversationExecution(store,userId,e.id));
    else throw new DomainError('Method not allowed.',405);
    return true;
  }
  if (url.pathname === "/api/conversations") {
    if (req.method === "GET") send(res, 200, listConversations(store, userId));
    else if (req.method === "POST") {
      rateLimit("conversation:" + userId, 20);
      send(res, 201, createConversation(store, userId, b));
    } else throw new DomainError("Method not allowed.", 405);
    return true;
  }
  const match = url.pathname.match(/^\/api\/conversations\/([^/]+)(\/turns)?$/);
  if (!match) return false;
  protectConversationInput(b?.input);
  if (req.method === "GET" && !match[2]) send(res, 200, workspaceSnapshot(store, userId, match[1]));
  else if (req.method === "POST" && match[2]) {
    rateLimit("workspace-turn:" + userId, 40);
    if(b.command) {
      const {input,command,clientTurnId,expectedVersion,visibleSetId}=b;
      send(res,200,await runWorkspaceTurn(store,userId,match[1],{input,command,clientTurnId,expectedVersion,visibleSetId},travel));
    } else {
      const e=submitConversationExecution(store,userId,match[1],b,{enqueue:b.async===true});
      if(b.async!==true)await runConversationExecution(store,userId,e.id,travel);
      send(res,b.async===true?202:200,workspaceSnapshot(store,userId,match[1]));
    }
  } else throw new DomainError("Method not allowed.", 405);
  return true;
}
