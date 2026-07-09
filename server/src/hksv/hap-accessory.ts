import { Accessory, Service, Characteristic, uuid, Perms } from 'hap-nodejs';
import { HKSV_UUIDS } from './manager'; // From Phase 4

export interface CameraCapabilities {
    hasBattery?: boolean;
    hasSiren?: boolean;
    hasFloodlight?: boolean;
    model: string;
    macAddress: string;
}

export class HKSVAccessoryBuilder {
    
    public buildCompositeCameraAccessory(name: string, capabilities: CameraCapabilities): Accessory {
        // Generate consistent UUID based on MAC address
        const accessoryUuid = uuid.generate('scryvex.camera.' + capabilities.macAddress);
        const cameraAccessory = new Accessory(name, accessoryUuid);

        // 1. Strict Identity Metadata (AccessoryInformation)
        cameraAccessory.getService(Service.AccessoryInformation)!
            .setCharacteristic(Characteristic.Manufacturer, "Scryvex Pro")
            .setCharacteristic(Characteristic.Model, capabilities.model)
            .setCharacteristic(Characteristic.SerialNumber, capabilities.macAddress)
            .setCharacteristic(Characteristic.FirmwareRevision, "3.9.3"); // Matter Bridge Version Map

        // 2. Primary Service: RTP Stream Management (added dynamically later via HKSVManager, 
        // but here we establish it conceptually, or it would be added by hap-nodejs CameraController)

        // 3. Linked Services
        // a) YOLOv10 Motion Sensor
        const motionService = new Service.MotionSensor(name + " Motion");
        cameraAccessory.addService(motionService);
        // Link logic happens by adding to the same Accessory. Apple Home groups them.

        // b) Battery (If applicable)
        if (capabilities.hasBattery) {
            const batteryService = new Service.BatteryService(name + " Battery");
            batteryService.setCharacteristic(Characteristic.BatteryLevel, 100);
            batteryService.setCharacteristic(Characteristic.StatusLowBattery, Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL);
            cameraAccessory.addService(batteryService);
        }

        // c) Siren (If applicable)
        if (capabilities.hasSiren) {
            const sirenService = new Service.Switch(name + " Sirena");
            // Optional: set specific subtype or properties if needed
            cameraAccessory.addService(sirenService);
        }

        // d) Floodlight (If applicable)
        if (capabilities.hasFloodlight) {
            const lightService = new Service.Lightbulb(name + " Reflector");
            cameraAccessory.addService(lightService);
        }

        // 4. iOS 27 Camera Toggles (Global Operating Modes)
        // CameraOperatingMode service
        const operatingModeService = new Service("Camera Operating Mode", HKSV_UUIDS.CameraGlobalOperatingMode);
        
        // Characteristic: Camera Status Light
        const statusLightChar = new Characteristic("Camera Status Light", "0000021D-0000-1000-8000-0026BB765291", {
            format: "bool",
            perms: [Perms.PAIRED_READ, Perms.PAIRED_WRITE, Perms.NOTIFY]
        });
        statusLightChar.setValue(true);
        operatingModeService.addCharacteristic(statusLightChar);

        // Characteristic: Night Vision Light
        const nightVisionChar = new Characteristic("Night Vision Light", "0000021E-0000-1000-8000-0026BB765291", {
            format: "bool",
            perms: [Perms.PAIRED_READ, Perms.PAIRED_WRITE, Perms.NOTIFY]
        });
        nightVisionChar.setValue(true);
        operatingModeService.addCharacteristic(nightVisionChar);

        cameraAccessory.addService(operatingModeService);

        return cameraAccessory;
    }

    public triggerYOLOMotion(accessory: Accessory, isDetected: boolean) {
        const motionService = accessory.getService(Service.MotionSensor);
        if (motionService) {
            motionService.updateCharacteristic(Characteristic.MotionDetected, isDetected);
        }
    }
}
