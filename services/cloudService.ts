
/**
 * Serviço de Nuvem simplificado usando JSONBin.io
 */

export class CloudService {
  private API_URL = 'https://api.jsonbin.io/v3/b';

  async sync(data: string, masterKey: string, existingBinId?: string): Promise<string> {
    if (!masterKey) throw new Error("Chave Mestra não informada.");

    const isUpdate = !!existingBinId;
    const url = isUpdate ? `${this.API_URL}/${existingBinId}` : this.API_URL;
    const method = isUpdate ? 'PUT' : 'POST';

    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      'X-Master-Key': masterKey,
    };

    if (!isUpdate) {
      headers['X-Bin-Private'] = 'true';
      headers['X-Bin-Name'] = 'fueltrack_cloud_db';
    }

    try {
      const response = await fetch(url, {
        method: method,
        headers: headers,
        body: data
      });

      const result = await response.json();

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          throw new Error("Permissão Negada: Sua Chave Mestra é inválida ou expirou.");
        }
        throw new Error(result.message || "Erro na comunicação com a nuvem.");
      }

      return isUpdate ? existingBinId! : result.metadata.id;
    } catch (err: any) {
      if (err.name === 'TypeError' && err.message.includes('fetch')) {
        throw new Error("Erro de Rede: Verifique sua conexão ou se um bloqueador de anúncios está impedindo o acesso ao JSONBin.");
      }
      throw err;
    }
  }

  async download(masterKey: string, binId: string): Promise<string> {
    if (!masterKey || !binId) throw new Error("Chave ou ID do container ausente.");

    try {
      const response = await fetch(`${this.API_URL}/${binId}/latest`, {
        method: 'GET',
        headers: {
          'X-Master-Key': masterKey,
        }
      });

      const result = await response.json();

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          throw new Error("Permissão Negada: Chave Mestra inválida.");
        }
        throw new Error(result.message || "Falha ao baixar dados.");
      }

      return JSON.stringify(result.record);
    } catch (err: any) {
      throw err;
    }
  }
}

export const cloudService = new CloudService();
