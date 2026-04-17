import fs from 'fs';
import { Queue, Worker, Job } from 'bullmq';
import axios from 'axios';
import dotenv from 'dotenv';
import { parse, differenceInMilliseconds } from 'date-fns';

import express from 'express';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';

import path from 'path';

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
async function agendarMensaje(mensaje: string, tiempoRecibido: string | undefined) {
    let delay = 1000; 

    if (tiempoRecibido) {
        try {
            const ahora = new Date();
            // Leemos el formato YYYY-MM-DD HH:mm:ss que viene de la IA
            const objetivo = parse(tiempoRecibido, 'yyyy-MM-dd HH:mm:ss', ahora);
            const diferencia = differenceInMilliseconds(objetivo, ahora);

            if (!isNaN(diferencia) && diferencia > 0) {
                delay = diferencia;
            }
        } catch (e) {
            console.error("❌ Error al procesar tiempo:", e);
        }
    }

    const finalDelay = isNaN(delay) ? 1000 : delay;

    await aiQueue.add('tarea-ia', 
        { prompt: mensaje, modelos: ['google/gemini-2.0-flash-lite-preview-02-05:free', 'meta-llama/llama-3.2-3b-instruct:free', 'openrouter/auto'] }, 
        { delay: finalDelay }
    );
    
    console.log(`🕒 [Queue] Agendado para dentro de: ${(finalDelay / 1000 / 60).toFixed(2)} minutos.`);
}

// 2. Función de extracción con IA (OPTIMIZADA)
async function extraerFechaConIA(texto: string): Promise<string | undefined> {
    // Usamos el formato local legible para humanos
    const ahora = new Date().toLocaleString("es-ES", { 
        year: 'numeric', month: '2-digit', day: '2-digit', 
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false 
    }).replace(/,/, ''); 
    
    const promptSistema = `
        Eres un extractor de tiempo para recordatorios.
        FECHA ACTUAL (Local): ${ahora}
        MENSAJE DEL USUARIO: "${texto}"
        
        INSTRUCCIONES:
        1. Calcula la fecha basándote en la FECHA ACTUAL LOCAL proporcionada.
        2. Devuelve EXCLUSIVAMENTE la fecha calculada en este formato: YYYY-MM-DD HH:mm:ss
        3. Si el usuario no menciona tiempo, devuelve: AHORA.
        4. No escribas nada más, ni la letra T, ni Z, ni explicaciones.
    `;

    try {
        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: "google/gemini-2.0-flash-001",
                messages: [{ role: "user", content: promptSistema }]
            })
        });

        const data = await response.json();
        const resultado = data.choices[0].message.content.trim();
        
        console.log(`🤖 IA calculó (Local): ${resultado}`);
        return resultado === "AHORA" ? undefined : resultado;
    } catch (e) {
        return undefined;
    }
}


// 1. Crear el adaptador de Express
const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath('/admin/queues');

// 2. Configurar BullBoard con tu cola actual
createBullBoard({
  queues: [new BullMQAdapter(aiQueue)],
  serverAdapter: serverAdapter,
});

const app = express();
app.use(express.json()); // Para poder recibir datos del formulario
app.use(express.urlencoded({ extended: true }));

// Servir archivos estáticos (el HTML que crearemos)
app.use(express.static('public'));

// RUTA PARA AGENDAR DESDE LA WEB
app.post('/api/agendar', async (req, res) => {
    const { prompt } = req.body;
    
    if (!prompt) return res.status(400).json({ error: "Falta el mensaje" });

    console.log(`🤖 IA analizando intención: "${prompt}"`);
    
    // Llamamos a la IA para que decida el 'cuando'
    const fechaProgramada = await extraerFechaConIA(prompt);
    
    // Agendamos la tarea usando la fecha que la IA calculó
    await agendarMensaje(prompt, fechaProgramada);
    
    res.json({ 
        status: 'ok', 
        message: 'Agente procesó la orden',
        programadoPara: fechaProgramada || 'Inmediato'
    });
});

// 2. Modifica tu ruta POST
app.post('/api/agendar', async (req, res) => {
    const { prompt } = req.body;
    const fechaExtraida = await extraerFechaConIA(prompt);
    await agendarMensaje(prompt, fechaExtraida);
    res.json({ status: 'ok' });
});

// 1. Obtener tareas para el dashboard
app.get('/api/tareas', async (req, res) => {
    // Obtenemos los últimos trabajos de la cola
    const [pendientes, completadas] = await Promise.all([
        aiQueue.getJobs(['delayed', 'waiting']),
        aiQueue.getJobs(['completed'], 0, undefined, false) // Solo los últimos 5 completados
    ]);

    const respuesta = {
        proximas: pendientes.map(j => ({
            id: j.id,
            prompt: j.data.prompt,
            correEn: j.opts.delay ? new Date(Number(j.timestamp) + j.opts.delay).toLocaleString() : 'Ahora'
        })),
        historial: completadas.map(j => ({
            id: j.id,
            prompt: j.data.prompt,
            finalizado: new Date(j.finishedOn!).toLocaleTimeString()
        }))
    };

    res.json(respuesta);
});

// 2. Eliminar tarea
app.delete('/api/tareas/:id', async (req, res) => {
    const { id } = req.params;
    const job = await aiQueue.getJob(id);

    if (job) {
        await job.remove();
        return res.json({ ok: true, message: "Tarea eliminada" });
    }
    res.status(404).json({ error: "Tarea no encontrada" });
});

// 3. Conectar el router del dashboard
app.use('/admin/queues', serverAdapter.getRouter());

app.listen(3000, () => {
  console.log('----------------------------------------------------');
  console.log('🚀 MONITOR ACTIVO v7.0.0');
  console.log('🔗 Revisa tus mensajes aquí: http://localhost:3000/admin/queues');
  console.log('----------------------------------------------------');
});

// --- BLOQUE FINAL DE EJECUCIÓN ---
// Solo debe haber uno de estos al final de tu archivo

const promptUser = process.argv[2];
const tiempoUser = process.argv[3]; // Esto viene como string desde la terminal

if (promptUser) {
    // Pasamos el tiempo directamente como string o undefined
    agendarMensaje(promptUser, tiempoUser);
} else {
    console.log('💡 Uso: npm run ask "Tu mensaje" 5000');
}