from services.analysis_service import hesapla_risk_durumu

def test_hesapla_risk_durumu_guvenli():
    # Aktif = 1000, Kapasitif = 50 (%5), Endüktif = 100 (%10) → Güvenli
    genel, kap_o, end_o, kap_s, end_s = hesapla_risk_durumu(1000, 50, 100)
    assert genel == "guvenli"
    assert kap_o == 5.0
    assert end_o == 10.0

def test_hesapla_risk_durumu_kapasitif_tehlikeli():
    # Aktif = 1000, Kapasitif = 160 (%16), Endüktif = 100 (%10) → Tehlikeli
    genel, kap_o, end_o, kap_s, end_s = hesapla_risk_durumu(1000, 160, 100)
    assert genel == "tehlikeli"
    assert kap_s == "tehlikeli"

def test_hesapla_risk_durumu_enduktif_tehlikeli():
    # Aktif = 1000, Kapasitif = 50 (%5), Endüktif = 220 (%22) → Tehlikeli (endüktif aşım)
    genel, kap_o, end_o, kap_s, end_s = hesapla_risk_durumu(1000, 50, 220)
    assert genel == "tehlikeli"
    assert end_s == "tehlikeli"
