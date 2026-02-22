
import { GoogleGenAI } from "@google/genai";
import { VeiculoEquipamento, MovimentoTanque } from "../types";

// Initialize the GoogleGenAI client with the API key from environment variables.
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

/**
 * Analyzes fuel efficiency using Gemini.
 */
export async function analyzeFuelEfficiency(
  vehicles: VeiculoEquipamento[],
  movements: MovimentoTanque[]
): Promise<string> {
  // Using gemini-3-flash-preview for efficiency analysis.
  const model = "gemini-3-flash-preview";
  
  const prompt = `
    Analise estes dados de combustível da frota com métricas de performance diferenciadas:
    
    CRITÉRIOS DE PERFORMANCE:
    - Veículos (KM): A performance é medida em KM por Litro (KM/L). Ideal: MAIOR valor (mais autonomia).
    - Equipamentos (HORIMETRO): A performance é medida em Litros por Hora (L/H). Ideal: MENOR valor (menos consumo por hora).
    
    Fórmulas:
    - Veículo: (Leitura Atual - Anterior) / Volume
    - Equipamento: Volume / (Leitura Atual - Anterior)
    
    DADOS:
    Veículos/Equipamentos: ${JSON.stringify(vehicles)}
    Histórico de Movimentos (contém eficiencia_calculada em KM/L ou L/H dependendo do ativo): ${JSON.stringify(movements)}
    
    TAREFAS:
    1. Calcule e valide as médias de rendimento para cada ativo.
    2. Identifique anomalias (KM/L muito baixo ou L/H muito alto).
    3. Sugira manutenções preventivas baseadas no uso e variações de performance.
    4. Avalie o estado do tanque principal (Estoque).
    
    Responda em Português do Brasil com Markdown elegante, use tabelas se necessário.
  `;

  try {
    // Generate content using the provided prompt and system instruction for persona.
    const response = await ai.models.generateContent({
      model,
      contents: prompt,
      config: { 
        systemInstruction: "Você é um analista de frota sênior especializado em logística e manutenção de equipamentos pesados.",
        temperature: 0.4 
      },
    });
    // Return the generated text response.
    return response.text || "Análise indisponível.";
  } catch (error) {
    console.error("Gemini analysis error:", error);
    return "Erro ao conectar com a IA para análise de eficiência.";
  }
}
