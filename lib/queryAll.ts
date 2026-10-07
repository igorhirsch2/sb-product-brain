// The API can cap results regardless of .limit(). Always page with stable ordering.
export async function queryAll<T = Record<string, any>>(query: (from:number,to:number)=>PromiseLike<{data:T[]|null;error:any}>,pageSize=500):Promise<T[]>{
  const rows:T[]=[]
  for(let from=0;;from+=pageSize){
    const {data,error}=await query(from,from+pageSize-1)
    if(error)throw error
    const batch=data||[];rows.push(...batch)
    if(batch.length<pageSize)return rows
  }
}
