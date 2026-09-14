import {writeFileSync} from 'node:fs';
import {travelerActions} from '../shared/travelerActions.mjs';
writeFileSync('src/travelerActions.ts','// Generated from shared/travelerActions.mjs by scripts/generate-traveler-actions.mjs.\nexport const travelerActions = '+JSON.stringify(travelerActions,null,2)+' as const;\nexport type TravelerActionId = typeof travelerActions[number]["id"];\n');
