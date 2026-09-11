import { useApp } from '../context';
import { Agent } from '../components/Agent';
import { Icon, Button, Badge, Field } from '../components/ui';
import { time, dateLabel, duration, readable } from '../api';
import { JourneyMap } from '../components/JourneyMap';
export default function Assistant({initialPrompt}:{initialPrompt:string}) {
  const {active,journeys,setActive,navigate,boot,result}=useApp();
  return <>
    <div className="page-heading"><div><h1>Wayline Assistant</h1><p>Plan routes, understand fares and review your connections.</p></div></div>
    <div className="assistant-workspace">
      <section className="assistant-conversation" aria-label="Your travel assistant"><Agent initialPrompt={initialPrompt} close={()=>{}} inline/></section>
      <aside className="assistant-trip-context">
        <Field label="Your journey"><select value={active?.version ? active.id : ''} onChange={e=>setActive(journeys.find(j=>j.id===e.target.value)??result?.journeys[0]??null)}><option value="">{result?'Current search result':'General travel planning'}</option>{journeys.map(j=><option value={j.id} key={j.id}>{j.from} → {j.to}</option>)}</select></Field>
        {active?<section className="panel assistant-journey-card"><span className="eyebrow">IN THIS CONVERSATION</span><h2>{active.from}<br/><span>to {active.to}</span></h2><p>{dateLabel(active.departure,active.timezone)}</p><div className="assistant-trip-times"><strong>{time(active.departure,active.timezone)}</strong><span><Icon name="train" size={19}/><small>{duration(active.durationMinutes)}</small></span><strong>{time(active.arrival,active.destinationTimezone)}</strong></div><Badge tone={active.dataMode==='illustrative'?'amber':'mint'}>{active.dataMode==='illustrative'?'Sample journey':readable(active.state??'planned')}</Badge><Button icon="arrow" onClick={()=>navigate(active.version?'journey':'plan')}>{active.version?'View full itinerary':'Review this route'}</Button></section>:<section className="panel"><span className="guardian-orb"><Icon name="route"/></span><h2>Choose a journey</h2><p>Select a saved journey or start planning to give your assistant the details.</p><Button icon="plus" onClick={()=>navigate('plan')}>Plan a journey</Button></section>}
        <section className="panel assistant-protection"><span className="guardian-orb"><Icon name="shield"/></span><h2>Journey protection</h2><p>Review connections and prepare alternatives for a saved journey.</p><div className="assistant-protection-state"><span>Automatic recovery</span><Badge tone={boot.user.preferences.autoRecovery?'mint':''}>{boot.user.preferences.autoRecovery?'On':'Off'}</Badge></div><Button icon="arrow" onClick={()=>navigate('journey')}>Journey protection</Button></section>
        {active&&<JourneyMap journey={active} compact/>}
      </aside>
    </div>
  </>;
}
