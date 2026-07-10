
export enum TipoVeiculo {
  VEICULO = 'VEICULO',
  EQUIPAMENTO = 'EQUIPAMENTO'
}

export enum MedidaUso {
  KM = 'KM',
  HORIMETRO = 'HORIMETRO'
}

export enum TipoMovimento {
  CONSUMO = 'CONSUMO',
  ENTRADA = 'ENTRADA',
  ENTRADA_BRITAGEM = 'ENTRADA_BRITAGEM',
  ENTRADA_OBRA = 'ENTRADA_OBRA'
}

export interface AppUser {
  id: string;
  login: string;
  password: string;
  role: 'admin' | 'operador';
  name: string;
  approved: boolean;
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
  tacografo_validade?: string; // Data de validade (YYYY-MM-DD)
  tacografo_afericao?: string; // Data de aferição (YYYY-MM-DD)
  oleo_data_ultima?: string; // Data da última troca (YYYY-MM-DD)
  oleo_km_proxima?: number; // KM da próxima troca de óleo
  oleo_horas_proxima?: number; // Horas da próxima troca de óleo (para equipamentos)
  controle_manutencao?: boolean; // Se o veículo/equipamento está sob controle de manutenção ativo
}

export interface MovimentoTanque {
  id: string;
  data_hora: string;
  tipo_movimento: TipoMovimento;
  litros: number;
  veiculo_id?: string; // Agora opcional para entradas no tanque principal
  tanque_id?: string; // Identificador do tanque (britagem, obra, wagner, marcus, paulo)
  usuario_id?: string; // Quem fez o lançamento
  motorista?: string;
  km_informado?: number;
  horimetro_informado?: number;
  valor_total?: number; // Valor da NF
  valor_unitario?: number; // Valor calculado do litro
  valor_frete?: number; // Valor do frete
  observacoes: string;
  eficiencia_calculada?: number;
  arla_litros?: number;
  arla_valor_total?: number;
  arla_valor_unitario?: number;
}

export interface Tanque {
  id: string;
  nome: string;
  capacidade_litros: number;
  saldo_atual: number;
}
