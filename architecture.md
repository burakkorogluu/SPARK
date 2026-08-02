# OSOS Reactive Power Management & Grid Simulation System
## System Architecture Documentation

This document provides a comprehensive overview of the architecture, components, data flows, and design patterns of the OSOS Reactive Power Management and Grid Simulation System (SPARK).

---

## 1. High-Level Overview

The system is a **Digital Twin and Decision Support System** designed for electrical distribution grid operators. Its primary objective is to monitor, predict, and mitigate reactive power penalty risks (under/over-compensation) across distribution transformers in accordance with TEİAŞ (Turkish Electricity Transmission Corporation) legal limits:
*   **Inductive Limit:** 20.0% of active power
*   **Capacitive Limit:** 15.0% of active power

### Key Capabilities
1.  **Real-Time Telemetry & SCADA Simulation:** Interactive Single Line Diagram (SLD) with live WebSocket updates.
2.  **Multi-Model Forecasting:** Predicts active, inductive, and capacitive power consumption using machine learning (XGBoost, LightGBM, Random Forest) and statistical models (Holt-Winters, Persistence, etc.).
3.  **Maneuver Simulation (Digital Twin):** Simulates the impact of topology changes (e.g., transferring feeders or switching reactors) on transformer load ratios and penalty risks before applying them to the physical grid.
4.  **Automated Alerts & Risk Analysis:** Real-time and historical tracking of threshold violations.

---

## 2. System Architecture Diagram

