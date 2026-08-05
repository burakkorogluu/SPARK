def _build_ensemble(xgb_preds, xgb_conf, rf_preds, rf_conf, reg_preds, reg_conf, lgb_preds, lgb_conf, transformer_id):
    data = []
    
    xgb_c = max(0, xgb_conf) if xgb_conf is not None else 0
    rf_c = max(0, rf_conf) if rf_conf is not None else 0
    reg_c = max(0, reg_conf) if reg_conf is not None else 0
    lgb_c = max(0, lgb_conf) if lgb_conf is not None else 0
    
    max_len = max(len(xgb_preds or []), len(rf_preds or []), len(reg_preds or []), len(lgb_preds or []))
    for i in range(max_len):
        valid_models = []
        if i < len(xgb_preds or []): valid_models.append((xgb_preds[i], xgb_c))
        if i < len(rf_preds or []): valid_models.append((rf_preds[i], rf_c))
        if i < len(reg_preds or []): valid_models.append((reg_preds[i], reg_c))
        if i < len(lgb_preds or []): valid_models.append((lgb_preds[i], lgb_c))
        
        good_models = [m for m in valid_models if m[1] > 10]
        if not good_models:
            good_models = valid_models
            
        if len(good_models) > 0:
            total_weight = sum(m[1] for m in good_models)
            if total_weight == 0:
                avg_active = int(sum(m[0]["active_kwh"] for m in good_models) / len(good_models))
                avg_cap = int(sum(m[0]["capacitive_kvarh"] for m in good_models) / len(good_models))
                avg_ind = int(sum(m[0]["inductive_kvarh"] for m in good_models) / len(good_models))
            else:
                avg_active = int(sum(m[0]["active_kwh"] * (m[1] / total_weight) for m in good_models))
                avg_cap = int(sum(m[0]["capacitive_kvarh"] * (m[1] / total_weight) for m in good_models))
                avg_ind = int(sum(m[0]["inductive_kvarh"] * (m[1] / total_weight) for m in good_models))
            
            data.append({
                "transformer_id": transformer_id,
                "timestamp": good_models[0][0]["timestamp"],
                "active_kwh": avg_active,
                "capacitive_kvarh": avg_cap,
                "inductive_kvarh": avg_ind,
                "kap_reason": good_models[0][0].get("kap_reason"),
                "end_reason": good_models[0][0].get("end_reason"),
                "is_forecast": True
            })

    valid_confs = [c for c in [xgb_c, rf_c, reg_c, lgb_c] if c > 0]
    confidence = round(sum(valid_confs) / len(valid_confs), 1) if valid_confs else 90.0
    return data, confidence
