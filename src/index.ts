import fs from 'fs';
import { Queue, Worker, Job } from 'bullmq';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const connection = { host: 'localhost', port: 6379 };

// Creamos la Fila
const aiQueue = new Queue('mensajes-ia', { connection });

// El Orquestador con Fallback
async function enviarConFallback(prompt: string, modelos: string[]) {
    for (const model of modelos) { // <--- Aquí estaba el error del nombre
        try {
            console.log(`📡 Intentando con: ${model}...`);
            const respuesta = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
                model: model,
                messages: [{ role: 'user', content: prompt }]
            }, {
                headers: { 
                    'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
                    'HTTP-Referer': 'http://localhost:3000',
                }
            });
            // Usamos 'model' que es la variable del bucle
            return { model, texto: respuesta.data.choices[0].message.content };
        } catch (error: any) {
            console.error(`⚠️ ${model} falló. Error:`, error.response?.data || error.message);
        }
    }
    throw new Error("❌ Ninguna IA pudo responder.");
}

// El Trabajador (Worker) con tipo explícito para 'job'
const worker = new Worker('mensajes-ia', async (job: Job) => {
    console.log(`📦 Procesando tarea: ${job.id}`);
    const resultado = await enviarConFallback(job.data.prompt, job.data.modelos);
    
    // --- NUEVA LÓGICA PARA GUARDAR EN ARCHIVO ---
    const nombreArchivo = `respuesta-${job.id}.txt`;
    const contenido = `MODELO: ${resultado.model}\nPROMPT: ${job.data.prompt}\n\nRESPUESTA:\n${resultado.texto}`;
    
    fs.writeFileSync(nombreArchivo, contenido);
    // --------------------------------------------

    console.log(`✅ ¡Éxito! Archivo ${nombreArchivo} creado.`);
}, { connection });

// Función para agendar
async function agendarMensaje(mensaje: string, retrasoMs: number) {
    await aiQueue.add('tarea-ia', 
        { 
            prompt: mensaje, 
            modelos: [
    'google/gemini-2.0-flash-lite-preview-02-05:free',
    'google/gemma-3-4b-it:free',
    'meta-llama/llama-3.2-3b-instruct:free',
    'qwen/qwen-2.5-7b-instruct:free',      // Corregido: era 2.5
    'microsoft/phi-3-medium-128k-instruct:free', // Corregido el ID
    'openrouter/auto' // 👈 EL TRUCO MAESTRO: OpenRouter elige el mejor gratis disponible
]
            }, 
        { 
            delay: retrasoMs,
            attempts: 5, // 🔄 ¡Inténtalo hasta 5 veces si falla!
            backoff: {
                type: 'exponential',
                delay: 10000 // Espera 10s, luego 20s, luego 40s...
            }
        }
    );
    console.log(`🕒 Tarea agendada. Si hay saturación, reintentaré automáticamente.`);
}

// Detectar si el usuario pasó un mensaje por terminal
const userPrompt = process.argv[2]; 

if (userPrompt) {
    agendarMensaje(userPrompt, 1000); // Lo agenda para dentro de 1 segundo
} else {
    console.log("💡 Uso: npx tsx src/index.ts \"Tu mensaje aquí\"");
}