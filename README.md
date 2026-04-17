🚀 SwitchBoard AI: Agente de IA Temporal

SwitchBoard AI es un asistente inteligente capaz de procesar lenguaje natural para agendar tareas futuras. Utiliza **Gemini 2.0** para extraer intenciones de tiempo y **BullMQ + Redis** para gestionar colas de trabajo con precisión de milisegundos.

## ✨ Características actuales
- **Procesamiento de Lenguaje Natural:** Entiende frases como "en 30 minutos" o "mañana a las 3pm".
- **Confirmación Manual:** Las tareas no se completan solas; al vencer el tiempo, pasan a un estado de "Por Confirmar" con alertas visuales y sonoras.
- **Arquitectura Resiliente:** Si el servidor se apaga, las tareas permanecen seguras en Redis.
- **Notificaciones de Escritorio:** Alertas en tiempo real mediante la API de Notificaciones del navegador.
- **Dashboard Interactivo:** Interfaz moderna construida con Tailwind CSS.

## 🛠️ Tecnologías
- **Backend:** Node.js, Express, TypeScript.
- **IA:** Google Gemini (vía OpenRouter).
- **Cola de Tareas:** BullMQ (Redis).
- **Frontend:** HTML5, JS (Vanilla), Tailwind CSS.
