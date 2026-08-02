# OSOS Reactive Power Management & Grid Simulation System (SPARK)
## System Architecture Documentation

This document provides a comprehensive, end-to-end architectural overview of the SPARK (OSOS Reactive Power Management and Grid Simulation) system. It details the system's design, component interactions, data flows, forecasting pipeline, and digital twin simulation capabilities.

---

## 1. High-Level Overview

The SPARK system is a **Digital Twin and Decision Support System** designed for electrical distribution grid operators. Its primary objective is to monitor, predict, and mitigate reactive power penalty risks (under/over-compensation) across distribution transformers in accordance with TEİAŞ (Turkish Electricity Transmission Corporation) and EPDK legal limits:
*   **Inductive Limit:** 20.0% of active power (Warning threshold: 16.0%, Attention threshold: 12.0%)
*   **Capacitive Limit:** 15.0% of active power (Warning threshold: 12.0%, Attention threshold: 10.0%)

### Key Capabilities
1.  **Real-Time Telemetry & SCADA Simulation:** Interactive Single Line Diagram (SLD) with live WebSocket updates, breaker toggles, and alarm acknowledgments.
2.  **Multi-Model Forecasting:** Predicts active, inductive, and capacitive power consumption using machine learning (XGBoost, LightGBM, Random Forest) and statistical models (Holt-Winters, Persistence, Moving Average, etc.).
3.  **Maneuver Simulation (Digital Twin):** Simulates the impact of topology changes (e.g., transferring feeders or switching reactors) on transformer load ratios and penalty risks before applying them to the physical grid.
4.  **Automated Alerts & Risk Analysis:** Real-time and historical tracking of threshold violations.

---

## 2. System Architecture Diagram

