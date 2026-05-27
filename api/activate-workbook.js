import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req,res){

    try{

        if(req.method !== "POST"){

            return res.status(405).json({
                success:false,
                error:"Method not allowed"
            });

        }

        const {

            email,
            licenseKey,
            workbookId

        } = req.body || {};

        if(
            !email ||
            !licenseKey ||
            !workbookId
        ){

            return res.status(400).json({

                success:false,
                error:"Missing required fields"

            });

        }

        const {data:license,error} =
        await supabase
        .from("licenses")
        .select("*")
        .eq(
            "email",
            email.trim().toLowerCase()
        )
        .eq(
            "license_key",
            licenseKey.trim()
        )
        .single();

        if(error || !license){

            return res.status(403).json({

                success:false,
                error:"License not found"

            });

        }

        if(
            license.status !== "ACTIVE"
        ){

            return res.status(403).json({

                success:false,
                error:"License inactive"

            });

        }

        if(
            license.current_period_end &&
            new Date(
                license.current_period_end
            ) < new Date()
        ){

            return res.status(403).json({

                success:false,
                error:"License expired"

            });

        }

        if(
            license.activated_workbook_id &&
            license.activated_workbook_id
            !== workbookId
        ){

            return res.status(403).json({

                success:false,
                error:
                "License already activated on another workbook"

            });

        }

        await supabase
        .from("licenses")
        .update({

            activated_workbook_id:
                workbookId,

            activated_at:
                new Date(),

            last_seen_at:
                new Date()

        })
        .eq(
            "id",
            license.id
        );

        return res.status(200).json({

            success:true

        });

    }

    catch(err){

        console.error(err);

        return res.status(500).json({

            success:false,
            error:
            "Activation failed"

        });

    }

}
