import db from '../config/sqlite'
import { randomUUID } from 'crypto'

export interface QueryResult {
  changes: number
  lastInsertRowid: number
}

export const query = {
  // For SELECT queries
  get: (sql: string, params: any[] = []) => {
    const stmt = db.prepare(sql)
    return stmt.get(...params)
  },
  
  // For SELECT queries returning multiple rows
  all: (sql: string, params: any[] = []) => {
    const stmt = db.prepare(sql)
    return stmt.all(...params)
  },
  
  // For INSERT/UPDATE/DELETE
  run: (sql: string, params: any[] = []) => {
    const stmt = db.prepare(sql)
    return stmt.run(...params)
  }
}

export const transaction = (callback: () => void) => {
  db.transaction(callback)()
}

export const generateId = () => randomUUID()