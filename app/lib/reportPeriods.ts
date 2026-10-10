const locale="en-CA";

export function reportPeriodDates(statementDate:string){
  const [year,month,day]=statementDate.split("-").map(Number);
  if(!year||!month||!day)throw new Error("Enter a valid statement date.");
  const current=new Date(Date.UTC(year,month-1,day));
  const previous=new Date(Date.UTC(year,month-1,0));
  return {current,previous};
}

export function reportPeriodLabels(statementDate:string){
  const {current,previous}=reportPeriodDates(statementDate);
  const full=(date:Date)=>date.toLocaleDateString(locale,{timeZone:"UTC",month:"short",day:"numeric",year:"numeric"});
  const month=(date:Date)=>date.toLocaleDateString(locale,{timeZone:"UTC",month:"long",year:"numeric"});
  return {current:full(current),previous:full(previous),currentMonth:month(current),previousMonth:month(previous)};
}
