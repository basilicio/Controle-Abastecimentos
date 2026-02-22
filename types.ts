
export enum TipoVeiculo {
  VEICULO = 'VEICULO',
  EQUIPAMENTO = 'EQUIPAMENTO'
}

export enum MedidaUso {
  KM = 'KM',
  HORIMETRO = 'HORIMETRO'
}

export enum TipoMovimento {
  ABASTECIMENTO = 'ABASTECIMENTO',
  CONSUMO = 'CONSUMO'
}

export interface AppUser {
  id: string;
  login: string;
  password: string;
  role: 'admin' | 'operador';
  name: string;
}

export interface VeiculoEquipamento {
  id: string;
  tipo: TipoVeiculo;
  placa_ou_prefixo: string;
  modelo: string;
  usa_medida: MedidaUso;
  odometro_atual: number;
  horimetro_atual: number;
  odometro_inicial: number;
  horimetro_inicial: number;
  ativo: boolean;
  usuario_id?: string; // Quem cadastrou o veículo
}

export interface MovimentoTanque {
  id: string;
  data_hora: string;
  tipo_movimento: TipoMovimento;
  litros: number;
  veiculo_id?: string; // Agora opcional para entradas no tanque principal
  usuario_id?: string; // Quem fez o lançamento
  motorista?: string;
  km_informado?: number;
  horimetro_informado?: number;
  observacoes: string;
  eficiencia_calculada?: number;
}

export interface Tanque {
  id: string;
  nome: string;
  capacidade_litros: number;
  saldo_atual: number;
}
