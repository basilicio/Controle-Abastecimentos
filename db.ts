
import { VeiculoEquipamento, MovimentoTanque, Tanque, AppUser } from './types';

const DB_NAME = 'FuelTrackDB';
const DB_VERSION = 2;

export class FuelDatabase {
  private apiUrl = '/api';

  async init(): Promise<void> {
    // No initialization needed for API proxy
    return Promise.resolve();
  }

  async getAll<T>(storeName: string): Promise<T[]> {
    try {
      const response = await fetch(`${this.apiUrl}/data`);
      const data = await response.json();
      return data[storeName] || [];
    } catch (e) {
      console.error("Erro ao buscar dados:", e);
      return [];
    }
  }

  async put(storeName: string, data: any): Promise<void> {
    try {
      const response = await fetch(`${this.apiUrl}/put/${storeName}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (!response.ok) throw new Error(`Erro ao salvar: ${response.statusText}`);
    } catch (e) {
      console.error("Erro ao salvar dado:", e);
      throw e;
    }
  }

  async delete(storeName: string, id: string): Promise<void> {
    try {
      const response = await fetch(`${this.apiUrl}/delete/${storeName}/${encodeURIComponent(id)}`, {
        method: 'DELETE'
      });
      if (!response.ok) throw new Error(`Erro ao deletar: ${response.statusText}`);
    } catch (e) {
      console.error("Erro ao deletar dado:", e);
      throw e;
    }
  }

  async exportAllData(): Promise<string> {
    const response = await fetch(`${this.apiUrl}/data`);
    const data = await response.json();
    return JSON.stringify({
      ...data,
      version: '5.0-cloud',
      timestamp: new Date().toISOString()
    });
  }

  async importAllData(jsonString: string): Promise<void> {
    try {
      const data = JSON.parse(jsonString);
      await fetch(`${this.apiUrl}/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
    } catch (e) {
      console.error("Erro na importação:", e);
      throw new Error("Falha ao importar dados para o servidor.");
    }
  }
}

export const db = new FuelDatabase();
