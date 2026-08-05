import os
import sys
import datetime
import random
import logging
import pandas as pd

# Setup logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("simbench_import")

try:
    import pandapower as pp
    import simbench as sb
except ImportError:
    logger.error("Pandapower or Simbench is not installed. Please install them first.")
    sys.exit(1)

# Add parent directory to path to import backend modules
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from database import SessionLocal
import models

def generate_hybrid_data(sb_code="1-HV-urban--0-sw", years=[2023, 2024, 2025, 2026]):
    logger.info(f"Loading SimBench network and profiles for {sb_code}...")
    net = sb.get_simbench_net(sb_code)
    
    # Check if profiles exist
    if sb.profiles_are_missing(net):
        logger.error(f"Profiles are missing for {sb_code}")
        return

    # Get absolute values for profiles (1 year, 15-min resolution)
    # This returns dicts of dataframes for active (p_mw) and reactive (q_mvar) power
    profiles = sb.get_absolute_values(net, profiles_instead_of_study_cases=True)
    
    if ("load", "p_mw") not in profiles:
        logger.error("No load profiles found in the dataset.")
        return
        
    p_mw_df = profiles[("load", "p_mw")]
    q_mvar_df = profiles[("load", "q_mvar")]
    
    logger.info(f"Loaded 1-year profiles. Shape: {p_mw_df.shape}")
    
    # For demonstration, we'll map SimBench load IDs to our Transformer IDs.
    # In a real scenario, this would be a specific mapping table.
    # Let's create dummy transformers if they don't exist, or map to 'UMR-TRA'.
    
    db = SessionLocal()
    try:
        # Check existing transformers
        existing_trafos = {t.id: t for t in db.query(models.Transformer).all()}
        
        # We will map the first 3 SimBench loads to SIS-TRA, KAD-TRA, BSK-TRA for diversity
        target_trafos = ["SIS-TRA", "KAD-TRA", "BSK-TRA"]
        
        for t_id in target_trafos:
            if t_id not in existing_trafos:
                logger.info(f"Creating missing transformer: {t_id}")
                
                # Determine logical names based on ID
                name_map = {
                    "SIS-TRA": ("Şişli TM – TRA", "Şişli"),
                    "KAD-TRA": ("Kadıköy TM – TRA", "Kadıköy"),
                    "BSK-TRA": ("Beşiktaş TM – TRA", "Beşiktaş")
                }
                t_name, t_region = name_map.get(t_id, (t_id, "Bilinmeyen Bölge"))
                
                new_t = models.Transformer(id=t_id, name=t_name, region=t_region, power_mva=100)
                db.add(new_t)
                # Add a couple of dummy feeders for the UI
                db.add(models.Feeder(id=f"{t_id}-F1", name=f"{t_id} Fider 1", current_transformer_id=t_id, simulated_load_kw=1500.0))
                db.add(models.Feeder(id=f"{t_id}-F2", name=f"{t_id} Fider 2", current_transformer_id=t_id, simulated_load_kw=2000.0))
                # Add a dummy reactor for compensation actions
                db.add(models.Reactor(id=f"{t_id}-R1", name=f"{t_id} Reaktör 1", current_transformer_id=t_id, capacity_kvar=5000.0, status="active"))
        db.commit()
        
        # Pick the largest loads from the network to match TEİAŞ scale
        largest_load_indices = net.load.sort_values(by='p_mw', ascending=False).index[:len(target_trafos)].tolist()
        load_cols = [p_mw_df.columns[i] for i in largest_load_indices]
        
        # Prepare batch insert list
        measurements_to_insert = []
        batch_size = 5000
        total_inserted = 0
        
        for year in years:
            logger.info(f"Generating data for year {year}...")
            
            # Trend factor: assume load grows 2% each year relative to 2023
            years_diff = year - 2023
            trend_factor = 1.0 + (0.02 * years_diff)
            
            # Base start date for the year
            start_date = datetime.datetime(year, 1, 1, 0, 0)
            
            # 1 year in 15-min intervals = 35040 steps
            for step in range(len(p_mw_df)):
                current_time = start_date + datetime.timedelta(minutes=15 * step)
                
                # Stop if we reach future date (e.g., currently August 2026)
                if current_time > datetime.datetime.now():
                    logger.info(f"Reached present time: {current_time}. Stopping generation.")
                    break
                
                # We can resample to hourly if we want to save space, but 15-min is fine.
                # Let's save hourly by only taking step % 4 == 0 to keep DB small for now
                if step % 4 != 0:
                    continue
                
                for idx, col in enumerate(load_cols):
                    t_id = target_trafos[idx]
                    
                    # Get base P and Q from SimBench (MW and MVAR -> kW and kVAR)
                    base_p_kw = p_mw_df.iloc[step][col] * 1000
                    base_q_kvar = q_mvar_df.iloc[step][col] * 1000
                    
                    # Apply Hybrid Variations: Trend + Noise
                    noise_p = random.uniform(0.95, 1.05)
                    noise_q = random.uniform(0.90, 1.10)
                    
                    final_p = max(0, int(base_p_kw * trend_factor * noise_p))
                    final_q = int(base_q_kvar * trend_factor * noise_q)
                    
                    # Convert Q to inductive/capacitive
                    inductive = final_q if final_q > 0 else 0
                    capacitive = abs(final_q) if final_q < 0 else 0
                    
                    # To keep it realistic but avoid completely replacing simulator logic entirely right now,
                    # we will just insert it. If the simulator overrides it later, it's fine.
                    
                    measurements_to_insert.append(models.Measurement(
                        transformer_id=t_id,
                        timestamp=current_time,
                        active_kwh=final_p,
                        inductive_kvarh=inductive,
                        capacitive_kvarh=capacitive
                    ))
                    
                if len(measurements_to_insert) >= batch_size:
                    db.bulk_save_objects(measurements_to_insert)
                    db.commit()
                    total_inserted += len(measurements_to_insert)
                    measurements_to_insert = []
                    
        # Insert remaining
        if measurements_to_insert:
            db.bulk_save_objects(measurements_to_insert)
            db.commit()
            total_inserted += len(measurements_to_insert)
            
        logger.info(f"Successfully inserted {total_inserted} highly realistic records for ML forecasting.")

    except Exception as e:
        logger.error(f"Database error during import: {e}")
        db.rollback()
    finally:
        db.close()

if __name__ == "__main__":
    logger.info("Starting Hybrid SimBench Data Generation (2023-2026)")
    # Default to generating data up to 2026
    generate_hybrid_data(years=[2023, 2024, 2025, 2026])
    logger.info("Generation complete.")
